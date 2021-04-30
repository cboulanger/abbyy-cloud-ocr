import {EventEmitter} from "events";
import * as path from "path";
import {tmpdir} from "os";

const {Ocrsdk, ProcessingSettings, TaskData} = require('./ocrsdk.js');
const {createWriteStream} = require('fs');
const {pipeline} = require('stream');
const {promisify} = require('util');
const streamPipeline = promisify(pipeline);
const fetch = require('node-fetch');

export {ProcessingSettings}

/**
 * The Abbyy Cloud OCR client class
 */
export class AbbyyOcr {
  /**
   * The events emitted by this class
   */
  static event = {
    uploading: 'AbbyyOcr.event.uploading',
    processing: 'AbbyyOcr.event.processing',
    downloading: 'AbbyyOcr.event.downloading'
  }

  /**
   * The event emitter exposed by the class
   */
  public emitter: EventEmitter

  /**
   * The settings
   */
  public settings: typeof ProcessingSettings;

  /**
   * The Abbyy ocrsdk module object
   * @private
   */
  private ocrsdk: typeof Ocrsdk;

  private fileName: string;
  private downloadUrls: string[];

  /**
   * Constructor
   * @param appId
   * @param password
   * @param serviceUrl
   * @param settings
   */
  constructor(appId:string, password:string, serviceUrl:string, settings?: typeof ProcessingSettings) {
    if (!appId || !password || !serviceUrl) {
      throw new Error("Incomplete parameters");
    }
    this.ocrsdk = new Ocrsdk(appId, password, serviceUrl);
    this.settings = settings || new ProcessingSettings();
    this.emitter = new EventEmitter;
    this.downloadUrls = [];
    this.fileName = "";
  }

  /**
   * Register an event handler
   * @param event
   * @param handler
   */
  public on(event: string|symbol, handler: (...args: any[]) => void) {
    this.emitter.on(event, handler)
  }

  /**
   * Uploads a document to the Abbyy OCR service and processes them.
   * @param {String} filePath
   */
  async process(filePath:string) : Promise<void> {
    this.fileName = path.basename(filePath);
    this.emitter.emit(AbbyyOcr.event.uploading, this.fileName);
    let taskData: typeof TaskData = await new Promise(((resolve, reject) => {
      this.ocrsdk.processImage(filePath, this.settings, (error: Error|null, taskData: typeof TaskData) => {
        if (error) {
          reject(error);
        } else if (!this.ocrsdk.isTaskActive(taskData)) {
          reject(new Error("Unexpected task status " + taskData.status));
        }
        resolve(taskData);
      });
    }));
    this.emitter.emit(AbbyyOcr.event.processing, this.fileName);
    taskData = await new Promise(((resolve, reject) => {
      this.ocrsdk.waitForCompletion(taskData.id, (error: Error|null, taskData: typeof TaskData) => {
        if (error) {
          reject(error);
        } else if (taskData.status.toString() !== 'Completed') {
          reject(taskData.error);
        } else {
          resolve(taskData);
        }
      });
    }));
    let urls = [];
    for (let resultId of ["resultUrl","resultUrl2","resultUrl3"]) {
      if (taskData[resultId]) {
        urls.push(taskData[resultId].toString());
      }
    }
    this.downloadUrls = urls;
  }

  /**
   * Returns an async generator that can be used in a `for await ()` loop that will iterate
   * as long as there are files to download. Each iteration of the loop downloads one file
   * and returns the path to it.
   * @param {String?} targetDir Optional directory to which to download the file. If not given,
   * a temporary directory is used
   * @returns {AsyncGenerator<string>}
   */
  async * downloadResult(targetDir?: string) : AsyncGenerator<string> {
    targetDir = targetDir || tmpdir();
    const extensions = this.settings.exportFormat.split(",").map((format : string) : string => {
      const ext = format.slice(0,3);
      return ["pdf","txt"].includes(ext) ? ext : format;
    } );
    for (let url of this.downloadUrls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unexpected response ${response.statusText}`);
      const fileName = this.fileName.split(".").slice(0,-1).concat([extensions.shift()]).join(".");
      const targetPath = path.join(targetDir, fileName);
      this.emitter.emit(AbbyyOcr.event.downloading, fileName);
      await streamPipeline(response.body, createWriteStream(targetPath));
      yield targetPath;
    }
  }
}
