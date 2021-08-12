import {AbbyyOcr, ProcessingSettings} from './src/index';
import {Command, program} from 'commander';

const process = require('process');
const dotenv = require('dotenv');
const Gauge = require('gauge');

(async () => {

  type OptionsType = {
    appId: string,
    password: string,
    serviceUrl: string,
    language? : string,
    exportFormat?: string,
    customOptions?: string
    outputPath?: string,
    filenames?: boolean,
    finished?: boolean,
    summary?: boolean,
    quiet?:boolean,
    debug?:boolean
  };

  // authentication options
  function addAuthOptions(command: typeof program) {
    command
      .option("-u, --service-url <url>", "The http endpoint of the Cloud OCR Service")
      .option("-i, --app-id <id>", "The id of the application")
      .option("-P, --password <password>", "The application password");
  }

  // process
  addAuthOptions(program
    .command("process <files...>")
    .description("Process the given files and download the results")
    .option("-l, --language <language>", "Recognition language or comma-separated list of languages, defaults to \"English\"")
    .option("-e, --export-format <format>", "Output format. One of: txt (default), txtUnstructured, rtf, docx, xlsx, pptx, pdfa, pdfSearchable, pdfTextAndImages, xml")
    .option("-c, --custom-options <options>", "Other custom options passed to REST-ful call,  like 'profile=documentArchiving'")
    .option("-o, --output-path <path>", "The path to which to save the processed files")
    .option("-F, --filenames", "Output the filenames of the processed and downloaded files")
    .option("-q, --quiet", "No messages or visual feedback except errors")
    .option("-d, --debug", "Output additional debug messages")
    .action(processFiles));

  // list
  addAuthOptions(program
    .command("list")
    .description("List ongoing or finished tasks.")
    .option("-S, --summary", "Return a summary (count) of current statuses.")
    .option("-f, --finished", "Only list finished tasks")
    .action(list));

  // info
  addAuthOptions(program.command("info").action(info));

  try {
    await program.parseAsync();
  } catch (e) {
    if (e.message.match(/^[0-9]{3} /) || typeof e.details != "undefined" ) {
      // HTTP Error Response or Abbyy Error Response
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  /**
   * Sets up and returns the OCR client
   * @return {AbbyyOcr}
   */
  function createClient(options: OptionsType) : AbbyyOcr{
    // load environment variables from config file, if it exists, and add missing config. CLI params take precedence
    dotenv.config();
    options.serviceUrl = options.serviceUrl || process.env.ABBYY_SERVICE_URL;
    options.appId = options.appId || process.env.ABBYY_APP_ID;
    options.password = options.password || process.env.ABBYY_APP_PASSWD;
    return new AbbyyOcr(options.appId, options.password, options.serviceUrl);
  }

  /**
   * Processes the files that are provided on the command line
   * @param files
   * @param options
   */
  async function processFiles(files : string[], options: OptionsType) : Promise<void>{
    const abbyyClient = createClient(options);
    if (options.debug) {
      abbyyClient.emitter.on(AbbyyOcr.event.uploading, filename => console.log(`>>> Uploading ${filename}`));
      abbyyClient.emitter.on(AbbyyOcr.event.processing, filename => console.log(`>>> Processing ${filename}`));
      abbyyClient.emitter.on(AbbyyOcr.event.downloading, filename => console.log(`>>> Downloading ${filename}`));
    }
    const settings = new ProcessingSettings(options.language, options.exportFormat, options.customOptions);
    for (let filePath of files) {
      options.quiet || options.filenames || console.log("Processing " + filePath);
      await abbyyClient.process(filePath, settings);
      for await (const processedFilePath of abbyyClient.downloadResult(options.outputPath) ) {
        options.quiet || console.info( (options.filenames ? "" : "Downloaded ") + processedFilePath);
      }
    }
  }

  /**
   * List ongoing and/or completed tasks
   * @param {OptionsType} options
   */
  async function list(options: OptionsType) {
    const ocr = createClient(options);
    const {tasks} = await (options.finished ? ocr.listFinishedTasks() : ocr.listTasks());
    let result = tasks;
    if (options.summary) {
      result = tasks.reduce((s : any, t) => {
        s[t.status] = s[t.status] ? s[t.status]+1 : 1
        return s;
      }, {});
    }
    console.log(JSON.stringify(result,null, 2));
  }

  /**
   * Output information on the current application
   * @param {OptionsType} options
   */
  async function info(options: OptionsType) {
    const ocr = createClient(options);
    const result = await ocr.getApplicationInfo();
    console.log(JSON.stringify(result,null, 2));
  }

})().catch(err => {
  console.log(err)
  process.exit(1)
})
