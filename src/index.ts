import {EventEmitter} from "events";
import * as path from "path";
import {tmpdir} from "os";
import * as querystring from "querystring";

const {Ocrsdk, ProcessingSettings, TaskData} = require('./ocrsdk.js');
const {createWriteStream} = require('fs');
const {pipeline} = require('stream');
const {promisify} = require('util');
const streamPipeline = promisify(pipeline);
const fetch = require('node-fetch');

export {ProcessingSettings}

enum HTTP_VERBS {
  GET = "get",
  POST = "post"
}

type ErrorStruct = {
  "code": string,
  "message": string,
  "target": string,
  "details"?: ErrorStruct[]
}

export type TaskStatusResponse = {
  "taskId": string,
  "registrationTime": string,
  "statusChangeTime": string,
  "status": string,
  "filesCount": string,
  "error"?: ErrorStruct
  "requestStatusDelay": number,
  "resultUrls": string[],
  "description": string
}

export type ApplicationInfoResponse = {
  "id": string,
  "displayName": string,
  "pages": number,
  "fields": number,
  "expires": string,
  "type": string
}


type KeyStringValueMap = {
  [key: string]: string
}

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

  // internal config
  private readonly ocrsdk: typeof Ocrsdk;
  private readonly serviceUrl: string;
  private readonly appId: string;
  private readonly password: string;
  private fileName: string;
  private downloadUrls: string[];

  /**
   * Constructor
   * @param appId
   * @param password
   * @param serviceUrl
   * @param settings
   */
  constructor(appId: string, password: string, serviceUrl: string) {
    if (!appId || !password || !serviceUrl) {
      throw new Error("Incomplete parameters");
    }
    this.ocrsdk = new Ocrsdk(appId, password, serviceUrl);
    this.appId = appId;
    this.password = password;
    this.serviceUrl = serviceUrl;
    this.emitter = new EventEmitter;
    this.downloadUrls = [];
    this.fileName = "";
  }

  /**
   * Call the Abbyy Cloud OCR V2 web API
   * @param verb
   * @param methodName
   * @param params
   * @param body
   * @private
   */
  private async callService(verb: HTTP_VERBS, methodName: string, params: KeyStringValueMap = {}, body?: string) {
    let url = `${this.serviceUrl}/v2/${methodName}?${querystring.stringify(params)}`;
    const auth = Buffer.from(this.appId + ":" + this.password, 'utf-8').toString('base64');
    const options: any = {
      method: verb,
      headers: {"Authorization": `Basic ${auth}`},
      body
    };
    let response;
    try {
      response = await fetch(url, options);
      return await response.json();
    } catch (e) {
      // see https://support.abbyy.com/hc/en-us/articles/360017326719-HTTP-status-codes-and-response-formats
      if (e.error !== undefined) {
        throw e.error;
      }
      throw new Error(`${response.status} ${response.statusText} @ ${response.url}`);
    }
  }

  /**
   * Register an event handler
   * @param event
   * @param handler
   */
  public on(event: string | symbol, handler: (...args: any[]) => void) {
    this.emitter.on(event, handler)
  }

  /**
   * Uploads a document to the Abbyy OCR service and processes them.
   * @param {String | Buffer} filePath
   */
  async process(filePath: string | Buffer, settings?: typeof ProcessingSettings): Promise<void> {
    this.settings = settings || new ProcessingSettings();
    // this.fileName = path.basename(filePath);
    // this.emitter.emit(AbbyyOcr.event.uploading, this.fileName);
    let taskData: typeof TaskData = await new Promise(((resolve, reject) => {
      this.ocrsdk.processImage(filePath, this.settings, (error: Error | null, taskData: typeof TaskData) => {
        if (error) {
          reject(error);
        } else if (!this.ocrsdk.isTaskActive(taskData)) {
          reject(new Error("Unexpected task status " + taskData.status));
        }
        resolve(taskData);
      });
    }));
    // this.emitter.emit(AbbyyOcr.event.processing, this.fileName);
    taskData = await new Promise(((resolve, reject) => {
      this.ocrsdk.waitForCompletion(taskData.id, (error: Error | null, taskData: typeof TaskData) => {
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
    for (let resultId of ["resultUrl", "resultUrl2", "resultUrl3"]) {
      if (taskData[resultId]) {
        urls.push(taskData[resultId].toString());
      }
    }
    this.downloadUrls = urls;
  }

  /**
   * @see https://support.abbyy.com/hc/en-us/articles/360017326679-listTasks-Method
   */
  public async listTasks(): Promise<{ tasks: TaskStatusResponse[] }> {
    return await this.callService(HTTP_VERBS.GET, "listTasks");
  }

  /**
   * @see https://support.abbyy.com/hc/en-us/articles/360017269900-listFinishedTasks-Method
   */
  public async listFinishedTasks(): Promise<{ tasks: TaskStatusResponse[] }> {
    return await this.callService(HTTP_VERBS.GET, "listFinishedTasks");
  }


  /**
   * @see https://support.abbyy.com/hc/en-us/articles/360017269860-getTaskStatus-Method
   * @param {string} taskId
   */
  public async getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
    return await this.callService(HTTP_VERBS.GET, "getTaskStatus", {taskId});
  }

  /**
   * @see https://support.abbyy.com/hc/en-us/articles/360017326699-getApplicationInfo-Method
   */
  public async getApplicationInfo(): Promise<ApplicationInfoResponse> {
    return await this.callService(HTTP_VERBS.GET, "getApplicationInfo");
  }


  /**
   * Returns an async generator that can be used in a `for await ()` loop that will iterate
   * as long as there are files to download. Each iteration of the loop downloads one file
   * and returns the path to it.
   * @param {String?} targetDir Optional directory to which to download the file. If not given,
   * a temporary directory is used
   * @returns {AsyncGenerator<string>}
   */
  public async* downloadResult(targetDir?: string): AsyncGenerator<string> {
    targetDir = targetDir || tmpdir();
    const extensions = this.settings.exportFormat.split(",").map((format: string): string => {
      const ext = format.slice(0, 3);
      return ["pdf", "txt"].includes(ext) ? format + "." + ext : format;
    });
    for (let url of this.downloadUrls) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unexpected response ${response.statusText}`);
      const fileName = this.fileName.split(".").slice(0, -1).concat([extensions.shift()]).join(".");
      const targetPath = path.join(targetDir, fileName);
      this.emitter.emit(AbbyyOcr.event.downloading, fileName);
      await streamPipeline(response.body, createWriteStream(targetPath));
      yield targetPath;
    }
  }
}
