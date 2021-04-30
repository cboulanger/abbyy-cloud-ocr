import {AbbyyOcr, ProcessingSettings} from './src/index';
import {program} from 'commander';

const process = require('process');
const dotenv = require('dotenv');
const Gauge = require('gauge');

(async () => {

  let options : {
    language? : string,
    exportFormat?: string,
    customOptions?: string
    outputPath?: string,
    serviceUrl?: string,
    appId?: string,
    password?: string,
    filenames?: boolean
  } = {};

  options = program
    .name("abbyy-cloud-ocr")
    .description('Sends one or more files to Abbyy Cloud OCR service and saves the processed files')
    .usage("[options] file1 [file2 [file3]...] ")
    .option("-l, --language <language>", "Recognition language or comma-separated list of languages, defaults to \"English\"")
    .option("-e, --export-format <format>", "Output format. One of: txt (default), txtUnstructured, rtf, docx, xlsx, pptx, pdfa, pdfSearchable, pdfTextAndImages, xml")
    .option("-c, --custom-options <options>", "Other custom options passed to REST-ful call,  like 'profile=documentArchiving'")
    .option("-o, --output-path <path>", "The path to which to save the processed files'")
    .option("-u, --service-url <url>", "The http endpoint of the Cloud OCR Service")
    .option("-i, --app-id <id>", "The id of the application")
    .option("-P, --password <password>", "The application password")
    .option("-F, --filenames", "Output the filenames of the processed and downloaded files")
    .parse()
    .opts() as typeof options;

  const fileList = program.args;

  // load environment variables from config file, if it exists, and add missing config. CLI params take precedence
  dotenv.config();
  options.serviceUrl = options.serviceUrl || process.env.ABBYY_SERVICE_URL;
  options.appId = options.appId || process.env.ABBYY_APP_ID;
  options.password = options.password || process.env.ABBYY_APP_PASSWD;

  // set up client
  const settings = new ProcessingSettings(options.language, options.exportFormat, options.customOptions);
  // @ts-ignore
  const ocr = new AbbyyOcr(options.appId, options.password, options.serviceUrl, settings);

  // Process!
  for (let filePath of fileList) {
    options.filenames || console.log("Processing " + filePath);
    await ocr.process(filePath);
    for await (const processedFilePath of ocr.downloadResult() ) {
      console.info( (options.filenames ? "" : "Downloaded ") + processedFilePath);
    }
  }

})().catch(err => {
  console.log(err)
  process.exit(1)
})
