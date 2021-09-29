import * as functions from "firebase-functions";
import * as Papa from "papaparse";
// const axios: AxiosInstance = require("axios");
import Busboy = require("busboy");
import path = require("path");
import os = require("os");
import fs = require("fs");

import nodeRequest = require("request");
import base64 = require("base-64");

import config from "./config/config";

const client_id = config.client_id;
const client_secret = config.client_secret;

console.log("Client ID is: " + client_id);
console.log("Client Secret is: " + client_secret);

// type Parameters = {
//   response_type: string;
//   client_id: string;
//   scope: string;
//   redirect_uri: string;
//   state: string;
// }

// let globalParams = {
//   currentAccessToken: "",
//   currentRefreshToken: "",
// }
exports.xeroAuth = functions.https.onRequest((request, response) => {
  const params = {
    client_id: client_id,
    client_secret: client_secret,
    response_type: "code",
    scope: "accounting.transactions",
    // redirect_uri: "https://cbkaccounting.com/redirect",
    redirect_uri: "https://us-central1-cbkaccounting.cloudfunctions.net/xeroRedirectUrl",
    state: "12345678",
  };
  functions.logger.info("Client ID is: " + client_id);
  functions.logger.info("Client Secret is: " + client_secret);
  console.log("Params is: " + JSON.stringify(params));
  const url = `https://login.xero.com/identity/connect/authorize?response_type=${params.response_type}&client_id=${params.client_id}&redirect_uri=${params.redirect_uri}&scope=${params.scope}&state=${params.state}`;
  console.log("URL is: " + url);
  // const options = {
  //   path: url,
  //   method: "POST",
  // };
  // response.status(200).send("Success");
  response.redirect(301, url);
});

exports.xeroRedirectUrl = functions.https.onRequest((request, response) => {
  console.log("Redirected with request body: " + JSON.stringify(request.body));
  console.log("Redirected with response: " + response);
  functions.logger.info("Redirected with request body: " + JSON.stringify(request.body));
  functions.logger.info("Redirected with response: " + response);

});

exports.xeroGetTenantConnections = functions.https.onRequest(async (request, response) => {
  // const params: Parameters = {
  //   response_type: "code",
  //   client_id: "086961535B91473FBBB22C0CABAE3887",
  //   scope: "accounting.transactions",
  //   redirect_uri: "https://cbkaccounting.com/redirect",
  //   state: "12345678",
  // };

  // const path = `https://login.xero.com/identity/connect/authorize?response_type=${params.response_type}&client_id=${params.client_id}&redirect_uri=${params.redirect_uri}&scope=${params.scope}&state=${params.state}`;
  const path2 = "https://api.xero.com/connections";
  const options = {
    path: path2,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xero-tenant-id": "4f8b6a62-d826-4dc9-9c43-76cf44175623",
      "Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgxNTcwRUZDMTkiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJISy1PWm5jdGJjQW8xbkp2MENZVmdWY09fQmsifQ.eyJuYmYiOjE2MzI5MDQxNjAsImV4cCI6MTYzMjkwNTk2MCwiaXNzIjoiaHR0cHM6Ly9pZGVudGl0eS54ZXJvLmNvbSIsImF1ZCI6Imh0dHBzOi8vaWRlbnRpdHkueGVyby5jb20vcmVzb3VyY2VzIiwiY2xpZW50X2lkIjoiMDg2OTYxNTM1QjkxNDczRkJCQjIyQzBDQUJBRTM4ODciLCJzdWIiOiI1Y2ExYzk4NjVkZjk1YTk2YmRjNzlhNmE5YjYzZDA0ZCIsImF1dGhfdGltZSI6MTYzMjkwNDE0NywieGVyb191c2VyaWQiOiI5ZmQ0Y2E2OS1lY2QwLTQ1ZDMtOTkxZS05ZDJmMGU3M2I0MDYiLCJnbG9iYWxfc2Vzc2lvbl9pZCI6IjIwMjhlYmEyYWQxZjQ1ZDJiMTc4MDY0ODQ4MmUwMDI2IiwianRpIjoiYWZjOWNhNTRiOWIyYTRjMzk3ZDkyMWZhOGNkNjlkYmMiLCJhdXRoZW50aWNhdGlvbl9ldmVudF9pZCI6IjhiZWQwMWI1LTkyODItNGEyMi05ZTI4LWIwNjQ3OTdmM2U0OSIsInNjb3BlIjpbImFjY291bnRpbmcudHJhbnNhY3Rpb25zIiwib2ZmbGluZV9hY2Nlc3MiXX0.QvyvOcvtX0W60aJ3QR97geJnlkfxIflswof-APMeaVqnkA95aU6SVGdmNV_lSouDGOvm4M8k2elKpKJPn4y9nZxCHCWb8HW_ELRgyNTbTotY5ck2HkKNTGC6tNVIMc0T-qv78RxMMeeiZ_PR-T3jTbkxCaNGtOQutYuG5gX6OQfX4Y8W-16cc0eMuijwZ_Egn3GwFdfUDmFIvZMgmQTYfZkXfcXzRRkQsUYMbSwWEJsKoH7gLui-H9TQOk6qvfe3OdhnpfnkY9ewR1M6ub0IUMXei-1wgXslZQ4YGApLwfvBKFAn7L5NVwv1IS-VVIxYaN9KHXnEHkRX5tDb8t3MBw",
    },
  };

  nodeRequest.get(path2, options, function (err, response, body) {
    console.log("error:", err);
    console.log("statusCode:", response && response.statusCode);
    console.log("body:", body);
  });

  response.status(200).send("Success");
});

exports.xeroRefresh = functions.https.onRequest((request, response) => {

  // const data = JSON.stringify({
  //   "grant_type": "refresh_token",
  //   "refresh_token": "412fc934409156afbfae5cd5e6f6143d803e7053dcfa527ca013d7ffd6dc64b6",
  // });
  // const formData = {
  //   "grant_type": "refresh_token",
  //   "refresh_token": "412fc934409156afbfae5cd5e6f6143d803e7053dcfa527ca013d7ffd6dc64b6",
  // };

  const params = {
    access_token: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjFDQUY4RTY2NzcyRDZEQzAyOEQ2NzI2RkQwMjYxNTgxNTcwRUZDMTkiLCJ0eXAiOiJKV1QiLCJ4NXQiOiJISy1PWm5jdGJjQW8xbkp2MENZVmdWY09fQmsifQ.eyJuYmYiOjE2MzI5MDc5NzcsImV4cCI6MTYzMjkwOTc3NywiaXNzIjoiaHR0cHM6Ly9pZGVudGl0eS54ZXJvLmNvbSIsImF1ZCI6Imh0dHBzOi8vaWRlbnRpdHkueGVyby5jb20vcmVzb3VyY2VzIiwiY2xpZW50X2lkIjoiMDg2OTYxNTM1QjkxNDczRkJCQjIyQzBDQUJBRTM4ODciLCJzdWIiOiI1Y2ExYzk4NjVkZjk1YTk2YmRjNzlhNmE5YjYzZDA0ZCIsImF1dGhfdGltZSI6MTYzMjkwNDE0NywieGVyb191c2VyaWQiOiI5ZmQ0Y2E2OS1lY2QwLTQ1ZDMtOTkxZS05ZDJmMGU3M2I0MDYiLCJnbG9iYWxfc2Vzc2lvbl9pZCI6IjIwMjhlYmEyYWQxZjQ1ZDJiMTc4MDY0ODQ4MmUwMDI2IiwianRpIjoiYWZjOWNhNTRiOWIyYTRjMzk3ZDkyMWZhOGNkNjlkYmMiLCJhdXRoZW50aWNhdGlvbl9ldmVudF9pZCI6IjhiZWQwMWI1LTkyODItNGEyMi05ZTI4LWIwNjQ3OTdmM2U0OSIsInNjb3BlIjpbImFjY291bnRpbmcudHJhbnNhY3Rpb25zIiwib2ZmbGluZV9hY2Nlc3MiXX0.ljrQW1dJtbkMHYyjiWkPSaEFYDCpBuAvj0f6_8mMJBtE1swfo0yWPP-yB8Bt5zLrp9QSDLnlQEaWiPvcg2G9zz9bGLgH0UnP3Zb6Mq0vCPuU-sXLxFZCqIObhRCPchB7a_JurIu4ixYx1_-8EKCu1rhFh86c1i5g7gkM3wgCY9f3q_en-mwor8TfIMOBddcMr2kDfB2hV6EUEz81dfTftIcGKdsKW1SALWff0Xf8uf1NBegh3rYgEuffLlnLeRIWKjQ3KEn7wNBOqWoUm1B2hKzDceU70CF1ZROkUcq4Q06eX17-p3FWmNS2OlJqpmc25gPpYLcazNrJlw5c2bC5DA",
    refresh_token: "768ac87e313f6a7f076484a76eb29059dddd46e167e81a5944abda68f351154e",
    client_id: "086961535B91473FBBB22C0CABAE3887",
    client_secret: "QYaNrGT2bZ_55emYv2DE2R3xAAhimWQpv_mmo7o2ofbhKO_6",
  };

  const url = "https://identity.xero.com/connect/token";
  const options = {
    method: "POST",
    path: url,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + base64.encode(`${params.client_id}:${params.client_secret}`),
    },
    // formData: formData,
    body: `grant_type=refresh_token&refresh_token=${params.refresh_token}`,
  };

  nodeRequest.post(url, options, function (err, response, body) {
    console.log("error:", err);
    console.log("statusCode:", response && response.statusCode);
    console.log("body:", body);

    if (response.statusCode == 200) {
      console.log("Proceed with execution");
      const resultBody: Record<string, string> = JSON.parse(body);
      const newRefreshToken: string = resultBody["refresh_token"];
      console.log("New Refresh Token: " + newRefreshToken);
    }

  });
  response.status(200).send("Success");
});

exports.xeroExhangeCode = functions.https.onRequest((request, response) => {

});

exports.inputXeroApi = functions.https.onRequest((request, response) => {
  // inputXeroApi2 | this function should be called by WebHooks, parsing in the csvFile - POST
  if (request.method !== "POST") {
    return response.status(405).end();
  }
  const busboy = new Busboy({ headers: request.headers });
  let tmpdir = os.tmpdir();
  tmpdir = path.join(tmpdir, "/Versify");

  console.log("Busboy init in functions!");
  functions.logger.info("Busboy init functions with tempDIR: " + tmpdir);
  // This object will accumulate all the uploaded files, keyed by their name.
  const uploads: any = {}; // Map<string, string>
  const fileWrites: any[] = []; // Promise<void>[]
  // This code will process each file uploaded.
  busboy.on("file", (fieldname, file, filename) => {
    // Note: os.tmpdir() points to an in-memory file system on GCF
    // Thus, any files in it must fit in the instance"s memory.
    console.log(`Processed file ${filename}`);
    console.log(`Processed fieldName ${fieldname}`);
    const filepath = path.join(tmpdir, filename);
    console.log("File path is: " + filepath);
    functions.logger.info("Filepath is: " + filepath);
    uploads[fieldname] = filepath;

    const writeStream = fs.createWriteStream(filepath);
    file.pipe(writeStream);

    // File was processed by Busboy; wait for it to be written.
    // Note: GCF may not persist saved files across invocations.
    // Persistent files must be kept in other locations
    // (such as Cloud Storage buckets).
    const promise = new Promise((resolve, reject) => {
      file.on("end", () => {
        console.log("writeStream end fileName: " + filename);
        console.log("writeStream end file: " + file);
        writeStream.end();

      });
      console.log("writeStream finish");
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    fileWrites.push(promise);
    console.log("fileWrites DONE push");
  });
  // Triggered once all uploaded files are processed by Busboy.
  // We still need to wait for the disk writes (saves) to complete.
  busboy.on("finish", async () => {
    await Promise.all(fileWrites);
    console.log("Busboy FINISH! Process saved files here");
    console.log("Uploads is: " + uploads);
    console.log(uploads["testData.csv"]);

    const tempFilePath = uploads["testData"];
    // Function to read csv which returns a promise so you can do async / await.
    const readCSV = async (filePath: fs.PathOrFileDescriptor) => {
      const csvFile = fs.readFileSync(filePath);
      const csvData = csvFile.toString();
      return new Promise<void>((resolve, reject) => {
        try {
          Papa.parse((csvData), {
            header: true,
            complete: (results: any) => {
              console.log("Complete", results.data.length, "records.");
              resolve(results.data);
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    };
    // just using functions for now
    const convertToJson = async () => {
      const parsedData: any = await readCSV(tempFilePath);
      // shows bankTransaction 1
      console.log("parsedData is index 0: \n" + parsedData);
      console.log(parsedData[0]);
      // shows bankTransaction 2
      console.log("parsedData is index 1: \n" + parsedData);
      console.log(parsedData[1]);
    };
    // callFunction
    convertToJson();

    for (const file in uploads) {
      fs.unlinkSync(uploads[file]);
    }
    response.status(204).send();
  });

  busboy.end(request.rawBody);
  // END
});

