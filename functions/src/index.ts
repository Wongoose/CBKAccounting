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

import admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const client_id = config.client_id;
const client_secret = config.client_secret;

console.log("Client ID is: " + client_id);
console.log("Client Secret is: " + client_secret);

const cbkAccountingCollection = db.collection("CBKAccounting");

const global_redirect_uri = "http://localhost:5001/cbkaccounting/us-central1/xeroRedirectUrl";
// const global_redirect_uri = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroRedirectUrl";

type Parameters = {
  client_id: string | undefined;
  client_secret: string | undefined,
  access_token?: string,
  refresh_token?: string,
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
}

// let globalParams = {
//   currentAccessToken: "",
//   currentRefreshToken: "",
// }
exports.xeroAuth = functions.https.onRequest((request, response) => {
  const params: Parameters = {
    client_id: client_id,
    client_secret: client_secret,
    response_type: "code",
    scope: "accounting.transactions",
    state: "12345678",
  };
  functions.logger.info("Client ID is: " + client_id);
  functions.logger.info("Client Secret is: " + client_secret);
  // console.log("Params is: " + JSON.stringify(params));
  const url = `https://login.xero.com/identity/connect/authorize?response_type=${params.response_type}&client_id=${params.client_id}&redirect_uri=${global_redirect_uri}&scope=${params.scope}&state=${params.state}`;
  console.log("URL is: " + url);
  // const options = {
  //   path: url,
  //   method: "POST",
  // };
  // response.status(200).send("Success");
  response.redirect(301, url);
});

exports.xeroRedirectUrl = functions.https.onRequest((request, response) => {

  const exchangeCode = request.query.code;
  const requestError = request.query.error;
  response.status(200).send("Success! Updated access_token and tenant_id");


  if (requestError) {
    // has error
    // response.status(404).send("An error has occured. Please try again.");
  } else if (exchangeCode) {
    console.log("Redirected with request code: " + exchangeCode);
    functions.logger.info("Redirected with request code: " + exchangeCode);

    const params: Parameters = {
      client_id: client_id,
      client_secret: client_secret,
    };

    const url = "https://identity.xero.com/connect/token";
    const options = {
      path: url,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + base64.encode(`${params.client_id}:${params.client_secret}`),
      },
      body: `grant_type=authorization_code&code=${exchangeCode}&redirect_uri=${global_redirect_uri}`,
      // body: `grant_type=authorization_code&code=${exchangeCode}&redirect_uri=global_redirect_uri`,
    };

    nodeRequest.post(url, options, async function (err, res, body) {
      console.log("error:", err);
      console.log("statusCode:", res && res.statusCode);
      console.log("body:", body);

      if (res.statusCode == 200) {
        // response.status(200).send("Done. Successful!");
        console.log("xerRedirectUrl | Proceed with execution");
        const resultBody: Record<string, string> = JSON.parse(body);
        const newAccessToken: string = resultBody["access_token"];
        const newRefreshToken: string = resultBody["refresh_token"];
        console.log("New Access Token: " + newAccessToken);
        console.log("New Refresh Token: " + newRefreshToken);

        await cbkAccountingCollection.doc("tokens").update({
          "access_token": newAccessToken,
          "refresh_token": newRefreshToken,
        });

        // getTenantConnections
        const tenantUrl = "http://localhost:5001/cbkaccounting/us-central1/xeroGetTenantConnections";
        const tenantOptions = {
          path: tenantUrl,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        };

        nodeRequest.post(tenantUrl, tenantOptions, function (err, response, body) {
          console.log("POST xeroGetTenantConnections");
        });
      }

    });
  } else {
    // response.send("Unkown Error!");
  }

});

exports.xeroGetTenantConnections = functions.https.onRequest(async (request, response) => {
  let _access_token = "";
  // let _refresh_token = "";

  await cbkAccountingCollection.doc("tokens").get().then((doc) => {
    const dataMap: any = doc.data();
    _access_token = dataMap["access_token"];
    // _refresh_token = dataMap["refresh_token"];
  });
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
      // "xero-tenant-id": "4f8b6a62-d826-4dc9-9c43-76cf44175623",
      "Authorization": `Bearer ${_access_token}`,
    },
  };

  nodeRequest.get(path2, options, function (err, response, body) {
    console.log("error:", err);
    console.log("statusCode:", response && response.statusCode);
    console.log("body:", body);

    if (response.statusCode == 200) {
      const jsonResponse: Record<string, string> = (JSON.parse(body))[0];
      console.log("jsonResponse index 0 | is: " + jsonResponse);
      const xeroTenantId = jsonResponse["tenantId"];
      console.log("xeroTenantId | is: " + xeroTenantId);
      cbkAccountingCollection.doc("tokens").update({
        "xero-tenant-id": xeroTenantId,
      });
    }
  });

  response.status(200).send("Success");
});

exports.xeroRefresh = functions.https.onRequest(async (request, response) => {

  let _access_token = "";
  let _refresh_token = "";

  // retrieve from firestore
  await cbkAccountingCollection.doc("tokens").get().then((doc) => {
    const dataMap: any = doc.data();

    if (dataMap != null || dataMap != undefined) {
      // there is data
      _access_token = dataMap["access_token"];
      _refresh_token = dataMap["refresh_token"];
      // console.log("Firestore | Access Token: " + _access_token);
      // console.log("Firestore | Refresh Token: " + _refresh_token);

    }
  });

  const params: Parameters = {
    client_id: client_id,
    client_secret: client_secret,
    access_token: _access_token,
    refresh_token: _refresh_token,
  };

  const url = "https://identity.xero.com/connect/token";

  const options = {
    method: "POST",
    path: url,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + base64.encode(`${params.client_id}:${params.client_secret}`),
    },
    body: `grant_type=refresh_token&refresh_token=${params.refresh_token}`,
  };

  nodeRequest.post(url, options, async function (err, response, body) {
    console.log("error:", err);
    console.log("statusCode:", response && response.statusCode);
    // console.log("body:", body);

    if (response.statusCode == 200) {
      console.log("Proceed with execution");
      const resultBody: Record<string, string> = JSON.parse(body);
      const newAccessToken: string = resultBody["access_token"];
      const newRefreshToken: string = resultBody["refresh_token"];
      console.log("New Access Token: " + newAccessToken);
      console.log("New Refresh Token: " + newRefreshToken);

      await cbkAccountingCollection.doc("tokens").update({
        "access_token": newAccessToken,
        "refresh_token": newRefreshToken,
      });
    }

  });
  response.status(200).send("Success");
});

// Call Xero API Functions
// function createBankAccount(access_token: string, xeroTenantId: string) {
//   console.log("createBankAccount Ran");

//   const url = "https://api.xero.com/api.xro/2.0/Accounts";
//   const bodyData = {
//     "Code": "200",
//     "Name": "Zheng Xiang Wong",
//     "Type": "BANK",
//     "BankAccountNumber": "101012041962",
//   };
//   const options = {
//     method: "PUT",
//     path: url,
//     headers: {
//       "Content-Type": "application/json",
//       "Authorization": "Bearer " + access_token,
//       "Xero-Tenant-Id": xeroTenantId,
//     },
//     body: JSON.stringify(bodyData),
//   };

//   nodeRequest.put(url, options, function (err, response, body) {
//     console.log("error:", err);
//     console.log("statusCode:", response && response.statusCode);
//     console.log("body:", body);
//     console.log("createBankAccount END");
//   });


// }

exports.createBankAccount = functions.https.onRequest(async (request, response) => {
  let _access_token = "";
  let _xeroTenantId = "";

  await cbkAccountingCollection.doc("tokens").get().then((doc) => {
    const dataMap: any = doc.data();

    if (dataMap != null || dataMap != undefined) {
      // there is data
      _access_token = dataMap["access_token"];
      _xeroTenantId = dataMap["xero-tenant-id"];
      // console.log("Firestore | Access Token: " + _access_token);
      // console.log("Firestore | Refresh Token: " + _refresh_token);
      const url = "https://api.xero.com/api.xro/2.0/Accounts";
      const bodyData = {
        "Code": "200",
        "Name": "Zheng Xiang Wong",
        "Type": "BANK",
        "BankAccountNumber": "101012041962",
      };
      const options = {
        method: "PUT",
        path: url,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + _access_token,
          "Xero-Tenant-Id": _xeroTenantId,
        },
        body: JSON.stringify(bodyData),
      };

      nodeRequest.put(url, options, function (err, response, body) {
        console.log("error:", err);
        console.log("statusCode:", response && response.statusCode);
        console.log("body:", body);
        console.log("createBankAccount END");
      });

    }
  });
  response.status(200).send("Success");

});
exports.xeroCreateBankTransaction = functions.https.onRequest(async (request, response) => {

  let _access_token = "";
  let _xeroTenantId = "";

  await cbkAccountingCollection.doc("tokens").get().then((doc) => {
    const dataMap: any = doc.data();

    if (dataMap != null || dataMap != undefined) {
      // there is data
      _access_token = dataMap["access_token"];
      _xeroTenantId = dataMap["xero-tenant-id"];
      // console.log("Firestore | Access Token: " + _access_token);
      // console.log("Firestore | Refresh Token: " + _refresh_token);

    }
  });

  let bodyData = request.rawBody.toString();
  console.log("Request Raw Body is: " + JSON.parse(bodyData));
  bodyData = JSON.parse(bodyData);

  const url = "https://api.xero.com/api.xro/2.0/BankTransactions";
  // const bodyData = {
  //   "bankTransactions": [
  //     {
  //       "Type": "RECEIVE",
  //       "Reference": "Paid for annual fees",
  //       "Date": "2021-10-01",
  //       "Contact": {
  //         "Name": "Mr Choo",
  //         "EmailAddress": "chewys@chumbaka.asia",
  //         "Phones": [
  //           {
  //             "PhoneType": "MOBILE",
  //             "PhoneNumber": "60163315288",
  //           },
  //         ],
  //         "BankAccountDetails": "ipay88: T074745694522",
  //       },
  //       "LineItems": [
  //         {
  //           "Description": "Paid for annual fees",
  //           "Quantity": 1.0,
  //           "UnitAmount": 300.0,
  //           "AccountCode": "7319",
  //         },
  //       ],
  //       "BankAccount": {
  //         "Code": "090",
  //       },
  //     },
  //   ],
  // };

  const options = {
    method: "POST",
    path: url,
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + _access_token,
      "Xero-Tenant-Id": _xeroTenantId,
    },
    body: JSON.stringify(bodyData),
  };

  nodeRequest.post(url, options, function (err, reponse, body) {
    console.log("error:", err);
    console.log("statusCode:", response && response.statusCode);
    console.log("body:", body);
  });

  response.status(200).send("success");
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
      return new Promise<Record<string, string>[]>((resolve, reject) => {
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

    // convert to JSON

    type XeroTransactionObject = {
      Type: string;
      Reference: any;
      Date: any;
      Contact: {
        Name: any;
        EmailAddress: any;
        Phones: {
          PhoneType: string;
          PhoneNumber: any;
        }[];
        BankAccountDetails: any;
      };
      LineItems: {
        Description: any;
        Quantity: number;
        UnitAmount: any;
        AccountCode: string;
      }[];
      BankAccount: {

      };
    }

    const listOfTransactions: Record<string, string>[] = await readCSV(tempFilePath);
    const listOfFormattedTransactions: XeroTransactionObject[] = [];

    listOfTransactions.forEach(function (transaction) {
      console.log("Transaction name: " + transaction["Name"]);
      const xeroTransactionObject: XeroTransactionObject = {
        "Type": "RECEIVE",
        "Reference": transaction["Remarks"],
        "Date": transaction["Date"],
        "Contact": {
          "Name": transaction["Name"],
          "EmailAddress": transaction["Email"],
          "Phones": [
            {
              "PhoneType": "MOBILE",
              "PhoneNumber": transaction["ContactNumber"],
            },
          ],
          "BankAccountDetails": transaction["TransactionID"],
        },
        "LineItems": [
          {
            "Description": transaction["Remarks"],
            "Quantity": 1.0,
            "UnitAmount": transaction["Amount Paid"],
            "AccountCode": "404",
          },
        ],
        "BankAccount": {
          "Code": "090",
        },
      };

      listOfFormattedTransactions.push(xeroTransactionObject);
    });

    console.log("Length of list of Formatted Transactions: " + listOfFormattedTransactions.length);

    // final JSON to parse to XeroApi
    const compiledXeroJson = {
      "bankTransactions": listOfFormattedTransactions,
    };

    const url = "http://localhost:5001/cbkaccounting/us-central1/xeroCreateBankTransaction";

    const options = {
      method: "POST",
      path: url,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(compiledXeroJson),
    };

    nodeRequest.post(url, options, function (err, response, body) {
      console.log("error:", err);
      console.log("statusCode:", response && response.statusCode);
      console.log("body:", body);
    });


    for (const file in uploads) {
      fs.unlinkSync(uploads[file]);
    }
    response.status(200).send(JSON.stringify(compiledXeroJson));
  });

  busboy.end(request.rawBody);
  // END
});

