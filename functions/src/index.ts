import * as functions from "firebase-functions";
import base64 = require("base-64");
import config from "./config/config";
import admin = require("firebase-admin");
import Busboy = require("busboy");
import os = require("os");
import fs = require("fs");
import path = require("path");
import { generateFirebaseOTP, post, readCSV, ReturnValue, validateBearerAuthToken, validateIpAddress, xeroCreateBankTransaction, xeroGetTenantConnections, xeroRefreshAccessToken, XeroTransactionObject } from "./helper";
import jwt = require("jsonwebtoken");
// import { signInEmailWithLink } from "./auth";
// import open = require("open");


admin.initializeApp();
const db = admin.firestore();
// const auth = admin.auth();
const cbkAccountingCollection = db.collection("CBKAccounting");

const { client_id, client_secret, jwt_secret_key } = config;

// console.log("Client ID is: " + client_id);
// console.log("Client Secret is: " + client_secret);

// const FUNCTION_AUTH_URL = "http://localhost:5001/cbkaccounting/us-central1/xeroManualAuth";
// const FUNCTION_REDIRECT_URL = "http://localhost:5001/cbkaccounting/us-central1/xeroRedirectUrl";
const FUNCTION_AUTH_URL = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroManualAuth";
const FUNCTION_REDIRECT_URL = "https://us-central1-cbkaccounting.cloudfunctions.net/xeroRedirectUrl";

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

// XERO MANUAL AUTH - INITIAL DEPLOYMENT FUNCTION
exports.xeroManualAuth = functions.https.onRequest(async (request, response) => {

  console.log("\nSTART OF xeroAuth\n");

  // const adminEmail = request.query["adminEmail"] as string;
  const MY_OTP = request.query["code"] as string;

  const params: Parameters = {
    client_id: client_id,
    client_secret: client_secret,
    response_type: "code",
    scope: "accounting.transactions",
    state: "12345678",
  };

  const url = `https://login.xero.com/identity/connect/authorize?response_type=${params.response_type}&client_id=${params.client_id}&redirect_uri=${FUNCTION_REDIRECT_URL}&scope=${params.scope}&state=${params.state}`;

  const doc = await db.collection("CBKAccounting").doc("details").get();
  const dataMap = doc.data();

  if (dataMap === undefined) throw Error("Access Token or Xero Tenant ID not found");

  const firebaseOTP = dataMap["otp"];

  // Validate OTP "code" query parameters
  if (MY_OTP == firebaseOTP) {
    // update with new 6 digit code
    await generateFirebaseOTP(db);
    response.redirect(301, url);
  } else {
    response.status(403).send("UNAUTHORIZED: Invalid OTP. Please try again.");
  }

  // NOT USED
  // const { success, value, statusCode } = await signInEmailWithLink(adminEmail, url, auth);

  // if (!success) {
  //   console.log(value);
  //   response.status(statusCode ?? 403).send(value?.toString());
  //   return;
  // }
  // await open(url);
  // response.status(200).send("Opening Redirect URL");


});

// REDIRECTED FROM XERO MANUAL AUTH
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

// MAIN BODY FUNCTION - CALLED BY WEBHOOK
exports.xeroInputMain = functions.https.onRequest(async (request, response) => {
  // inputXeroApi | this function should be called by WebHooks, parsing in the csvFile - POST

  if (request.method !== "POST") {
    response.status(405).send({
      error: "METHOD-NOT-ALLOWED",
      message: "You have sent an invalid response to this URL. Please use POST request instead.",
    });
    return;
  }

  // CODE NOT USED
  // const { success, value, statusCode } = await validateBearerAuthToken(request, db);

  // if (!success) {
  //   console.log(value);
  //   response.status(statusCode ?? 403).send(value?.toString());
  //   return;
  // }

  // IP WHITELISTING NOT USED
  // const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

  // if (!resultIP.success) {
  //   console.log(resultIP.value);
  //   response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
  //   return;
  // }

  const token = request.headers.authorization?.split(" ")[1];
  console.log("verifyJwt | token is: " + token);
  console.log("verifyJwt | body is: " + request.body);

  if (token === undefined) {
    response.status(403).send({
      error: "MISSING-TOKEN",
      message: "Could not find token in authorization header. Request rejected.",
    });
    return;
  }

  if (jwt_secret_key === undefined) {
    response.status(500).send({
      error: "INTERNAL-SERVER-ERROR",
      message:
        "Missing JSON Web Token secret key in our server. Please contact your Firebase Cloud Functions Developer at wong.zhengxiang@gmail.com.",
    });
    return;
  }

  jwt.verify(token, jwt_secret_key, { algorithms: ["HS256"] }, async function (error, decoded) {
    if (error) {
      // invalid token - reject request
      response.status(403).send({
        error: "JWT-VERIFY-ERROR",
        message: error.message,
      });
      return;
    } else {
      if (decoded?.id && request.body.id && decoded?.id === request.body.id) {
        // payment id is a match - jwt payload && request.body

        console.log("\nJWT VERIFY FLOW SUCCESS! PAYLOAD ID MATCHED.\n");

        const listOfFormattedTransactions: XeroTransactionObject[] = [];
        const transaction: Record<string, string> = request.body;
        // FUTURE IMPLEMENTATION - request body may hold a list of transactions

        console.log("PAYLOAD TEST | Name: " + transaction.name);
        console.log("PAYLOAD TEST | Email: " + transaction.email);
        console.log("PAYLOAD TEST | Date: " + transaction.transaction_date);

        functions.logger.info("PAYLOAD DATA: " + JSON.stringify(transaction));

        const xeroTransactionObject: XeroTransactionObject = {
          "Type": "RECEIVE",
          "Reference": transaction.remarks + " | iPay88",
          "Date": transaction.transaction_date,
          "CurrencyCode": transaction.currency,
          "Contact": {
            "Name": transaction.name,
            "EmailAddress": transaction.email ?? transaction.student_email,
            "Phones": [
              {
                "PhoneType": "MOBILE",
                "PhoneNumber": transaction.phone,
              },
            ],
            "BankAccountDetails": "iPay88" + " | " + transaction.ip_s_bankname,
          },
          "LineItems": [
            {
              "Description": transaction.remarks + " | iPay88 transaction ID: " + transaction.ip_transid,
              // "ItemCode": transaction.id,
              "Quantity": 1.0,
              "UnitAmount": transaction.ip_amount,
              "AccountCode": "404",

            },
          ],
          "BankAccount": {
            "Code": "090",
          },
        };

        listOfFormattedTransactions.push(xeroTransactionObject);

        const compiledXeroJson = {
          "bankTransactions": listOfFormattedTransactions,
        };

        const resultOTP = await generateFirebaseOTP(db);

        const NEW_FUNCTION_AUTH_URL = FUNCTION_AUTH_URL + "?code=" + resultOTP;

        const { statusCode, body, error } = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

        switch (statusCode) {
          case 200:
            console.log("Update transactions successful");
            functions.logger.info("UDPATE TRANSACTION SUCCESSFUL");
            // May want to redirect to webpage with UI explanation - IF SUCCESS 200

            response.status(200).send({
              message: "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
            });

            break;

          case 401: {
            const refreshSuccess = await xeroRefreshAccessToken(db);
            if (!refreshSuccess) {
              console.log("xeroRefreshAccessToken | Failed");
              functions.logger.info("AUTO REFRESH | FAILED - NO ACTION WAS PERFORMED TO XERO");
              response.status(401).send({
                error: "XERO-ERROR",
                messsage: "Failed to auto-refresh xero access token. Function terminated.",
              });
            } else {
              const retryResult = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
              const retryStatusCode = retryResult.statusCode;
              const retryBody = retryResult.body;
              const retryError = retryResult.error;

              if (retryStatusCode !== 200) {
                console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
                if (retryStatusCode === 403) {
                  functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);

                  response.status(403).send({
                    error: "XERO-NEED-MANUAL-AUTH",
                    message: "This app is not authorized to connect with your organization. Please manually authorize tihs app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
                    action: NEW_FUNCTION_AUTH_URL,
                  });

                } else {
                  functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | UNKOWN ERROR - NO ACTION WAS PERFORMED TO XERO API");
                  response.status(retryStatusCode).send(retryError ?? retryBody);
                }
              } else {
                console.log("Update transactions successful");
                functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | SUCCESSFUL");
                response.status(200).send({
                  error: null, message:
                    "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
                });
              }
            }
            break;
          }

          case 403:
            console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
            functions.logger.info("CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);
            response.status(403).send({
              error: "XERO-NEED-MANUAL-AUTH",
              message: "This app is not authorized to connect with your organization. Please manually authorize tihs app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
              action: NEW_FUNCTION_AUTH_URL,
            });
            break;

          case 500:
            console.log("xeroCreateBankTransactions | Failed with internal catch error: " + error);
            functions.logger.error("xeroCreateBankTransactions | Failed with internal catch error: " + error);

            response.status(500).send({
              error: "INTERNAL-SERVER-ERROR",
              message: error + "\n\nNOTE: Please contact your Firebase Cloud Functions Developer at wong.zhengxiang@gmail.com.",
            });

            break;

          default:
            console.log("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
            functions.logger.error("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
            response.status(statusCode).send({
              error: "XERO-ERROR",
              message: "NOTE: An error has occured while calling the XERO API. Your request has been terminated. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com." + "\n\nRESPONSE BODY FROM XERO:\n\n" + body,
            });
        }


      } else {
        console.log("\nJWT VERIFY FAILED because payload ID mismatched\n");
        functions.logger.error("\nJWT VERIFY FAILED because payload ID mismatched\n");
        response.status(403).send({
          error: "MISMATCHED-PAYLOAD",
          message:
            "Your JSON Web Token decoded payload does not match with your request body. Request rejected",
        });
        return;
      }
    }
  });
});

// NOT USED - INPUT CSV FILE
exports.inputFile = functions.https.onRequest(async (request, response) => {
  // inputXeroApi | this function should be called by WebHooks, parsing in the csvFile - POST

  if (request.method !== "POST") {
    response.status(405).send("You have sent an invalid response to this url. No action performed.");
    return;
  }

  const { success, value, statusCode } = await validateBearerAuthToken(request, db);

  if (!success) {
    console.log(value);
    response.status(statusCode ?? 403).send(value?.toString());
    return;
  }

  const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

  if (!resultIP.success) {
    console.log(resultIP.value);
    response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
    return;
  }

  const busboy = new Busboy({ headers: request.headers });
  const tmpdir = os.tmpdir();
  let global_field_name: string;

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
    global_field_name = fieldname;

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
    console.log(uploads[global_field_name]);

    const tempFilePath = uploads[global_field_name];


    // convert to JSON
    const listOfTransactions: Record<string, string>[] = await readCSV(tempFilePath);
    const listOfFormattedTransactions: XeroTransactionObject[] = [];

    for (const transaction of listOfTransactions) {
      console.log("Transaction name: " + transaction["Description"]);
      if (transaction["Description"] == undefined) {
        // empty transaction line - IGNORE
      } else {
        const xeroTransactionObject: XeroTransactionObject = {
          "Type": transaction["Type"],
          "Reference": transaction["Reference"],
          "Date": transaction["Date"],
          "CurrencyCode": transaction["CurrencyCode"],
          "Contact": {
            "Name": transaction["Description"],
            "EmailAddress": transaction["Email"],
            "Phones": [
              {
                "PhoneType": "MOBILE",
                "PhoneNumber": transaction["ContactNumber"],
              },
            ],
            "BankAccountDetails": transaction["TransactionId"],
          },
          "LineItems": [
            {
              "Description": transaction["Reference"],
              "Quantity": 1.0,
              "UnitAmount": transaction["Amount"],
              "AccountCode": transaction["AccountCode"],

            },
          ],
          "BankAccount": {
            "Code": transaction["BankCode"],
          },
        };

        listOfFormattedTransactions.push(xeroTransactionObject);
      }
    }

    console.log("Length of list of Formatted Transactions: " + listOfFormattedTransactions.length);

    if (listOfFormattedTransactions.length == 0) {
      response.status(400).send("INVALID INPUT DATA: Your CSV File does not have any valid transactions. No action was performed.");
      return;
    }
    // final JSON to parse to XeroApi
    const compiledXeroJson = {
      "bankTransactions": listOfFormattedTransactions,
    };

    const resultOTP = await generateFirebaseOTP(db);

    const NEW_FUNCTION_AUTH_URL = FUNCTION_AUTH_URL + "?code=" + resultOTP;

    const { statusCode } = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

    switch (statusCode) {
      case 200:
        console.log("Update transactions successful");
        response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson));
        break;

      case 401: {
        const refreshSuccess = await xeroRefreshAccessToken(db);
        if (!refreshSuccess) {
          console.log("xeroRefreshAccessToken | Failed");
          response.status(401).send("You are not authorized.");
        } else {
          const retryResult = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
          const retryStatusCode = retryResult.statusCode;
          if (retryStatusCode !== 200) {
            console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
            if (retryStatusCode === 403) {
              response.status(403).send("This app is unauthorized or the auth has been resetted. Please manually authorize this app to connect with your xero organization here: \n" + NEW_FUNCTION_AUTH_URL);
            } else {
              response.status(500).send("Your function call has been terminated, please try again.");
            }
          } else {
            console.log("Update transactions successful");
            response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson));
          }
        }
        break;
      }

      case 403:
        console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
        response.status(403).send("This app is unauthorized or the auth has been resetted. Please manually authorize this app to connect with your xero organization here: \n" + NEW_FUNCTION_AUTH_URL);
        break;

      default:
        console.log("xeroCreateBankTransactions | Failed functions catch with statusCode: " + statusCode);
        response.status(500).send("POSSIBLE INVALID CSV FORMAT: No data has been processed for this endpoint. This endpoint is expecting BankTransaction data to be specifed in the request body. Please check your CSV file and try again.");
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

// NOT USED
exports.xeroGetTenantConnections = functions.https.onRequest(async (request, response) => {

  const { success, value, statusCode } = await validateBearerAuthToken(request, db);

  if (!success) {
    console.log(value);
    response.status(statusCode ?? 403).send(value?.toString());
    return;
  }

  const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

  if (!resultIP.success) {
    console.log(resultIP.value);
    response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
    return;
  }

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

// NOT USED
exports.xeroRefreshToken = functions.https.onRequest(async (request, response) => {
  console.log("\nCLOUD FUNCTION START OF xeroRefreshToken:\n");

  console.log("xeroinputMain | RAN from request IP: " + request.ips[0]);

  const { success, value, statusCode } = await validateBearerAuthToken(request, db);

  if (!success) {
    console.log(value);
    response.status(statusCode ?? 403).send(value?.toString());
    return;
  }

  const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

  if (!resultIP.success) {
    console.log(resultIP.value);
    response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
    return;
  }

  // console.log("xeroinputMain | RAN from request headers x-forwarded-for: " + request.headers["x-forwarded-for"]);
  // console.log("xeroinputMain | RAN from request socket.remoteAddress: " + request.socket.remoteAddress);
  // console.log("xeroinputMain | RAN from request X-Forwarded-For: " + request.headers["X-Forwared-For"]);
  // console.log("xeroinputMain | RAN from request connection: " + request.headers.connection);
  // console.log("xeroinputMain | RAN from request IP: " + request.ip);
  // console.log("xeroinputMain | RAN from request Origin: " + request.headers.origin);
  // console.log("xeroinputMain | RAN from request IPs: " + request.ips);

  const refreshSuccess = await xeroRefreshAccessToken(db);

  if (refreshSuccess) {
    console.log("Cloud Function xeroRefreshToken | Success");
    response.status(200).send("Access Token and Refresh Token updated successful.");
  } else {
    console.log("Cloud Function xeroRefreshToken | Failed");
    response.status(500).send("Failed to update Access Token and Refresh Token, please try again.");
  }

});

// NOT USED
exports.xeroCreateBankTransaction = functions.https.onRequest(async (request, response) => {
  const { success, value, statusCode } = await validateBearerAuthToken(request, db);

  if (!success) {
    console.log(value);
    response.status(statusCode ?? 403).send(value?.toString());
    return;
  }

  const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

  if (!resultIP.success) {
    console.log(resultIP.value);
    response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
    return;
  }

  const result = await xeroCreateBankTransaction(db, request.body);
  const status = result.statusCode;

  if (status !== 200) {
    console.log("Cloud Function xeroCreateBankTransaction | Failed");
    response.status(500).send("Failed to create Bank Transaction in Xero");
  } else {
    response.status(200).send("SUCCESS! \n\nReference data you'd uploaded: \n\n" + JSON.stringify(request.body));
  }
});