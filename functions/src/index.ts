import * as functions from "firebase-functions";
import nodeRequest = require("request");
import base64 = require("base-64");
import config from "./config/config";
import admin = require("firebase-admin");
import Busboy = require("busboy");
import os = require("os");
import fs = require("fs");
import path = require("path");
import { post, readCSV, xeroCreateBankTransaction, xeroGetTenantConnections, xeroRefreshAccessToken, XeroTransactionObject } from "./helper";

admin.initializeApp();
const db = admin.firestore();
const cbkAccountingCollection = db.collection("CBKAccounting");

const { client_id, client_secret } = config;

console.log("Client ID is: " + client_id);
console.log("Client Secret is: " + client_secret);

// const FUNCTION_AUTH_URL = "http://localhost:5001/cbkaccounting/us-central1/xeroAuth";
// const FUNCTION_REDIRECT_URL = "http://localhost:5001/cbkaccounting/us-central1/xeroRedirectUrl";
const FUNCTION_AUTH_URL = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroAuth";
const FUNCTION_REDIRECT_URL = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroRedirectUrl";

// const global_xeroGetTenantConnections = "http://localhost:5001/cbkaccounting/us-central1/xeroGetTenantConnections";
// const global_xeroRefresh = "http://localhost:5001/cbkaccounting/us-central1/xeroRefresh";
// const global_xeroCreateBankTransaction = "http://localhost:5001/cbkaccounting/us-central1/xeroCreateBankTransaction";
// const global_xeroGetTenantConnections = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroGetTenantConnections";
// const global_xeroRefresh = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroRefresh";
// const global_xeroCreateBankTransaction = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroCreateBankTransaction";

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

exports.xeroAuth = functions.https.onRequest((request, response) => {

  console.log("\nSTART OF xeroAuth\n");

  const params: Parameters = {
    client_id: client_id,
    client_secret: client_secret,
    response_type: "code",
    scope: "accounting.transactions",
    state: "12345678",
  };

  const url = `https://login.xero.com/identity/connect/authorize?response_type=${params.response_type}&client_id=${params.client_id}&redirect_uri=${FUNCTION_REDIRECT_URL}&scope=${params.scope}&state=${params.state}`;
  console.log("URL is: " + url);

  response.redirect(301, url);
});

exports.xeroRedirectUrl = functions.https.onRequest(async (request, response) => {

  const { code, error } = request.query;


  if (error) {
    // has error
    // response.status(404).send("An error has occured. Please try again.");
  } else if (code) {
    console.log("xeroRedirectURL | Redirected with request code: " + code);

    const params: Parameters = {
      client_id: client_id,
      client_secret: client_secret,
    };

    const url = "https://identity.xero.com/connect/token";
    const { statusCode, body } = await post({
      method: "POST",
      url: url,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + base64.encode(`${params.client_id}:${params.client_secret}`),
      },
      body: `grant_type=authorization_code&code=${code}&redirect_uri=${FUNCTION_REDIRECT_URL}`,
    });

    console.log("xeroRedirectUrl | statusCode:", statusCode);
    console.log("xeroRedirectUrl | body:", body);

    if (statusCode === 200) {
      console.log("xeroRedirectUrl | Proceed with execution");
      const resultBody: Record<string, string> = JSON.parse(body);
      const newAccessToken: string = resultBody["access_token"];
      const newRefreshToken: string = resultBody["refresh_token"];
      console.log("New Refresh Token: " + newRefreshToken);

      await cbkAccountingCollection.doc("tokens").update({
        "access_token": newAccessToken,
        "refresh_token": newRefreshToken,
      });

      const result = await xeroGetTenantConnections(db, newAccessToken);

      if (result) {
        console.log("xeroRedirectUrl | after getTenantConnections SUCCESS");
        response.status(200).send("Authorization flow successful. You may now call your first request with CBKAccounting");
      } else {
        console.log("xeroRedirectUrl | after getTenantConnections FAILED");
        response.status(500).send("Failed to update Xero Tenant ID, please try again here: \n" + FUNCTION_AUTH_URL);
      }
    } else {
      console.log("xeroRedirectUrl | FAILED");
      response.status(500).send("Failed to proceed with authorization, please try again here: \n" + FUNCTION_AUTH_URL);
    }
  }
});


exports.xeroGetTenantConnections = functions.https.onRequest(async (request, response) => {
  const cbkAccountingCollection = db.collection("CBKAccounting");
  const doc = await cbkAccountingCollection.doc("tokens").get();
  const dataMap = doc.data();

  if (dataMap === undefined) throw Error("Access Token or Refresh Token not found");

  const accessToken = dataMap["access_token"];

  const getTenantConnectionsSuccess = await xeroGetTenantConnections(db, accessToken);

  if (getTenantConnectionsSuccess) {
    console.log("Cloud Function xeroGetTenantConnections | Success");
    response.status(200).send("Xero Tenant ID updated successful.");
  } else {
    console.log("Cloud Function xeroGetTenantConnections | Failed");
    response.status(500).send("Failed to update Xero Tenant ID, please try again.");

  }
});

exports.xeroRefreshToken = functions.https.onRequest(async (request, response) => {
  console.log("\n CLOUD FUNCTION START OF xeroRefreshToken:\n");
  const refreshSuccess = await xeroRefreshAccessToken(db);

  if (refreshSuccess) {
    console.log("Cloud Function xeroRefreshToken | Success");
    response.status(200).send("Access Token and Refresh Token updated successful.");
  } else {
    console.log("Cloud Function xeroRefreshToken | Failed");
    response.status(500).send("Failed to update Access Token and Refresh Token, please try again.");

  }

});

exports.createBankAccount = functions.https.onRequest(async (request, response) => {
  let _access_token = "";
  let _xeroTenantId = "";

  let dataMap: any | undefined;

  await cbkAccountingCollection.doc("tokens").get().then((doc) => {
    dataMap = doc.data();

    if (dataMap != null || dataMap != undefined) {
      // there is data
      _access_token = dataMap["access_token"];
      _xeroTenantId = dataMap["xero-tenant-id"];
    }
  });

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

  response.status(200).send("Success");
});

exports.xeroCreateBankTransaction = functions.https.onRequest(async (request, response) => {
  const statusCode = await xeroCreateBankTransaction(db, request.body);

  if (statusCode !== 200) {
    console.log("Cloud Function xeroCreateBankTransaction | Failed");
    response.status(500).send("Failed to create Bank Transaction in Xero");
  } else {
    response.status(200).send("SUCCESS! \n\nReference data you'd uploaded:\n\n" + JSON.stringify(request.body));
  }
});

exports.inputXeroMain = functions.https.onRequest((request, response) => {
  // inputXeroApi | this function should be called by WebHooks, parsing in the csvFile - POST
  if (request.method !== "POST") {
    return response.status(405).end();
  }
  const busboy = new Busboy({ headers: request.headers });
  const tmpdir = os.tmpdir();

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


    // convert to JSON
    const listOfTransactions: Record<string, string>[] = await readCSV(tempFilePath);
    const listOfFormattedTransactions: XeroTransactionObject[] = [];

    for (const transaction of listOfTransactions) {
      console.log("Transaction name: " + transaction["Name"]);

      const xeroTransactionObject: XeroTransactionObject = {
        "Type": transaction["Type"],
        "Reference": transaction["Remarks"],
        "Date": transaction["Date"],
        "CurrencyCode": transaction["Currency"],
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
            "UnitAmount": transaction["Amount"],
            "AccountCode": "7319",
          },
        ],
        "BankAccount": {
          "Code": "090",
        },
      };

      listOfFormattedTransactions.push(xeroTransactionObject);
    }

    console.log("Length of list of Formatted Transactions: " + listOfFormattedTransactions.length);

    // final JSON to parse to XeroApi
    const compiledXeroJson = {
      "bankTransactions": listOfFormattedTransactions,
    };

    const statusCode = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

    switch (statusCode) {
      case 200:
        console.log("Update transactions successful");
        response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded:\n\n" + JSON.stringify(compiledXeroJson));
        break;

      case 401: {
        const refreshSuccess = await xeroRefreshAccessToken(db);
        if (!refreshSuccess) {
          console.log("xeroRefreshAccessToken | Failed");
          response.status(401).send("You are not authorized.");
        } else {
          const retryStatusCode = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
          if (retryStatusCode !== 200) {
            console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
            if (retryStatusCode === 403) {
              response.status(403).send("This app is unauthorized or the auth has been resetted. Please authorize this app manually by following this link: \n" + FUNCTION_AUTH_URL);
            } else {
              response.status(500).send("Your function call has been terminated, please try again.");
            }
          } else {
            console.log("Update transactions successful");
            response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded:\n\n" + JSON.stringify(compiledXeroJson));
          }
        }
        break;
      }

      case 403:
        console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
        response.status(403).send("This app is unauthorized or the auth has been resetted. Please authorize this app manually by following this link: \n" + FUNCTION_AUTH_URL);
        break;

      default:
        console.log("xeroCreateBankTransactions | Failed functions called.");
        response.status(500).send("No data has been processed for this endpoint. This endpoint is expecting BankTransaction data to be specifed in the request body.");
    }

    // const url = global_xeroCreateBankTransaction;

    // const options = {
    //   method: "POST",
    //   path: url,
    //   headers: {
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify(compiledXeroJson),
    // };

    // nodeRequest.post(url, options, function (err, response, body) {
    //   console.log("error:", err);
    //   console.log("statusCode:", response && response.statusCode);
    //   console.log("body:", body);
    // });


    for (const file in uploads) {
      fs.unlinkSync(uploads[file]);
    }
    console.log("END");
  });

  busboy.end(request.rawBody);
  // END
});
