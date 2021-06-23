/**
 * This code is taken from https://github.com/abbyy/ocrsdk.com/blob/master/JavaScript/ocrsdk.js
 * Published under an Apache License 2.0 available at https://raw.githubusercontent.com/abbyy/ocrsdk.com/master/LICENSE
 * It has been updated to better meet modern javascript standards.
 * @type {module:http}
 */
"use strict"
const http = require("http");
const https = require("https");
const url = require("url");
const fs = require('fs');
const xml2js = require('xml2js');

/**
 * Settings used to process image
 */
class ProcessingSettings {

  /**
   * Creates a new ProcessingSettings object
   * @param {string} language Recognition language or comma-separated list of languages, defaults to "English"
   * @param {string} exportFormat Output format. One of: txt (default), rtf, docx, xlsx, pptx, pdfSearchable, pdfTextAndImages, xml.
   * @param {string} customOptions Other custom options passed to REST-ful call,  like 'profile=documentArchiving' (optional)
   */
  constructor(language="English", exportFormat = "txt", customOptions="") {
    this.language = language;
    this.exportFormat = exportFormat;
    this.customOptions = customOptions;
  }

  /**
   * Convert processing settings to string passed to REST-ful request.
   */
  asUrlParams() {
    let result;
    if (this.language.length != null) {
      result = '?language=' + this.language;
    } else {
      result = '?language=English';
    }
    if (this.exportFormat.length != null) {
      result += '&exportFormat=' + this.exportFormat;
    } else {
      result += "&exportFormat=txt"
    }
    if (this.customOptions.length > 0) {
      result += '&' + this.customOptions;
    }
    return result;
  }
}

/**
 * TaskData object used in functions below has the following important fields:
 * {string} id
 * {string} status
 * {string} resultUrl
 *
 * It is mapped from xml described at
 * https://ocrsdk.com/documentation/specifications/status-codes/
 */
const TaskData = {
  id: undefined,
  status: undefined,
  resultUrl: undefined
}

class Ocrsdk {
  /**
   * Create a new ocrsdk object.
   *
   * @constructor
   * @param {string} applicationId  Application Id.
   * @param {string} password    Password for the application you received in e-mail.
   * @param serviceUrl The http endpoint of the service
   * To create an application and obtain a password,
   * register at https://cloud.ocrsdk.com/Account/Register
   * More info on getting your application id and password at
   * https://ocrsdk.com/documentation/faq/#faq3
   */
  constructor(applicationId, password, serviceUrl) {
    this.appId = applicationId;
    this.password = password;
    this.serverUrl = serviceUrl;
  }

  /**
   * Upload file to server and start processing.
   *
   * @param {string | Buffer} filePath          Path to the file to be processed.
   * @param {ProcessingSettings} [settings]    Image processing settings.
   * @param {function(error: Error, taskData: TaskData)} userCallback The callback function.
   */
  processImage(filePath, settings, userCallback) {
    
    let fileContents;
    if (typeof filePath === 'string') {
      fileContents = fs.readFileSync(filePath);
    }
    else fileContents = filePath;
    if (settings == null) {
      settings = new ProcessingSettings();
    }
    let urlOptions = settings.asUrlParams();
    let req = this._createTaskRequest('POST', '/processImage' + urlOptions, userCallback);

    req.write(fileContents);
    req.end();
  }

  /**
   * Get current task status.
   *
   * @param {string} taskId Task identifier as returned in taskData.id.
   * @param {function(error: Error, taskData: TaskData)} userCallback The callback function.
   */
  getTaskStatus(taskId, userCallback) {
    let req = this._createTaskRequest('GET', '/getTaskStatus?taskId=' + taskId,
      userCallback);
    req.end();
  }

  /**
   * Returns true if the task is active
   * @param {TaskData} taskData
   * @return {boolean}
   */
  isTaskActive(taskData) {
    return String(taskData.status) === 'Queued' || String(taskData.status) === 'InProgress';
  }

  /**
   * Wait until task processing is finished. You need to check task status after
   * processing to see if you can download result.
   *
   * @param {string} taskId            Task identifier as returned in taskData.id.
   * @param {function} userCallback
   */
  waitForCompletion(taskId, userCallback) {
    // Call getTaskStatus every several seconds until task is completed

    // Note: it's recommended that your application waits
    // at least 2 seconds before making the first getTaskStatus request
    // and also between such requests for the same task.
    // Making requests more often will not improve your application performance.
    // Note: if your application queues several files and waits for them
    // it's recommended that you use listFinishedTasks instead (which is described
    // at https://ocrsdk.com/documentation/apireference/listFinishedTasks/).
    if (taskId.indexOf('00000000') > -1) {
      // A null Guid passed here usually means a logical error in the calling code
      userCallback(new Error('Null id passed'), null);
      return;
    }
    let recognizer = this;
    let waitTimeout = 5000;
    function waitFunction() {
      recognizer.getTaskStatus(taskId,
        function (error, taskData) {
          if (error) {
            userCallback(error, null);
            return;
          }
          if (recognizer.isTaskActive(taskData)) {
            setTimeout(waitFunction, waitTimeout);
          } else {
            userCallback(null, taskData);
          }
        });
    }
    setTimeout(waitFunction, waitTimeout);
  }


  /**
   * Download result of document processing. Task needs to be in 'Completed' state
   * to call this function.
   *
   * @param {string} resultUrl        URL where result is located
   * @param {string} outputFilePath      Path where to save downloaded file
   * @param {function(error: Error, taskData: TaskData)} userCallback  The callback function.
   */
  downloadResult(resultUrl, outputFilePath, userCallback) {
    let file = fs.createWriteStream(outputFilePath);
    let parsed = url.parse(resultUrl);
    let req = https.request(parsed, function (response) {
      response.on('data', function (data) {
        file.write(data);
      });
      response.on('end', function () {
        file.end();
        userCallback(null, null);
      });
    });
    req.on('error', function (error) {
      userCallback(error, null);
    });
    req.end();
  }

  /**
   * Create http GET or POST request to cloud service with given path and
   * parameters.
   *
   * @param {string} method        'GET' or 'POST'.
   * @param {string} urlPath        REST-ful verb with parameters, e.g. '/processImage/language=French'.
   * @param {function(error: Error, taskData: TaskData)} taskDataCallback User callback which is called when request is executed.
   * @return {http.ClientRequest}    Created request which is ready to be started.
   */
  _createTaskRequest(method, urlPath, taskDataCallback) {
    /**
     * Convert server xml response to TaskData. Calls taskDataCallback after.
     *
     * @param data  Server XML response.
     */
    function parseXmlResponse(data) {
      let response = null;
      let parser = new xml2js.Parser({
        explicitCharKey: false,
        trim: true,
        explicitRoot: true,
        mergeAttrs: true
      });
      parser.parseString(data, function (err, objResult) {
        if (err) {
          taskDataCallback(err, null);
          return;
        }
        response = objResult;
      });
      if (response == null) {
        return;
      }
      if (response.response == null || response.response.task == null
        || response.response.task[0] == null) {
        if (response.error != null) {
          taskDataCallback(new Error(response.error.message[0]['_']), null);
        } else {
          taskDataCallback(new Error("Unknown server response"), null);
        }
        return;
      }
      let task = response.response.task[0];
      taskDataCallback(null, task);
    }
    function getServerResponse(res) {
      res.setEncoding('utf8');
      res.on('data', parseXmlResponse);
    }
    let requestOptions = url.parse(this.serverUrl + urlPath);
    requestOptions.auth = this.appId + ":" + this.password;
    requestOptions.method = method;
    requestOptions.headers = {
      'User-Agent': "node.js client library"
    };
    let req;
    if (requestOptions.protocol === 'http:') {
      req = http.request(requestOptions, getServerResponse);
    } else {
      req = https.request(requestOptions, getServerResponse);
    }
    req.on('error', function (e) {
      taskDataCallback(e, null);
    });
    return req;
  }
}

module.exports = {
  Ocrsdk,
  TaskData,
  ProcessingSettings
}


