import * as functions from "firebase-functions";
import base64 = require("base-64");
import config from "./config/config";
import admin = require("firebase-admin");
import { generateFirebaseOTP, generateTransactionLog, getListOfNewTransactions, post, sendInitMail, sendWeeklyReportMail, xeroGetTenantConnections, XeroTransactionObject } from "./helper";
import jwt = require("jsonwebtoken");
import converter = require("json-2-csv");

// import { signInEmailWithLink } from "./auth";
// import open = require("open");
// import Busboy = require("busboy");
// import os = require("os");
import fs = require("fs");
// import path = require("path");


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
    scope: "offline_access accounting.transactions",
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
    response.status(403).send("UNAUTHORIZED: Invalid OTP. This link may have been used or it is expired.");
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
              "AccountCode": "502-000",

            },
          ],
          "BankAccount": {
            "Code": "310-S01",
          },
        };

        // const xeroTransactionObject: XeroTransactionObject = {
        //   "Type": "RECEIVE",
        //   "Reference": "Test blank reference | iPay88",
        //   "Date": "2021-10-21",
        //   "CurrencyCode": transaction.currency,
        //   "Contact": {
        //     "Name": "Test blank name",
        //     "EmailAddress": "test@example.com",
        //     "Phones": [
        //       {
        //         "PhoneType": "MOBILE",
        //         "PhoneNumber": "60123456789",
        //       },
        //     ],
        //     "BankAccountDetails": "Test iPay88" + " | " + "blank bank name",
        //   },
        //   "LineItems": [
        //     {
        //       "Description": "Test description | iPay88 transaction ID: example12345678 ",
        //       // "ItemCode": transaction.id,
        //       "Quantity": 1.0,
        //       "UnitAmount": 0.10,
        //       "AccountCode": "502-000",

        //     },
        //   ],
        //   "BankAccount": {
        //     "Code": "310-S01",
        //   },
        // };

        listOfFormattedTransactions.push(xeroTransactionObject);

        // DISCONNECT XERO -----------------
        // const compiledXeroJson = {
        //   "bankTransactions": listOfFormattedTransactions,
        // };

        // DISCONNECT XERO -----------------
        // const resultOTP = await generateFirebaseOTP(db);

        // DISCONNECT XERO -----------------
        // const NEW_FUNCTION_AUTH_URL = FUNCTION_AUTH_URL + "?code=" + resultOTP;

        // DISCONNECT XERO -----------------
        await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
        response.status(200).send({ message: "TRANSACTION PROCESSED SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(transaction) });

        // DISCONNECT XERO -----------------
        // const { statusCode, body, error } = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

        // switch (statusCode) {
        //   case 200:
        //     console.log("Update transactions successful");
        //     functions.logger.info("UDPATE TRANSACTION SUCCESSFUL");
        //     // May want to redirect to webpage with UI explanation - IF SUCCESS 200

        //     await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, true);

        //     response.status(200).send({
        //       message: "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
        //     });

        //     break;

        //   case 401: {
        //     const refreshSuccess = await xeroRefreshAccessToken(db);
        //     if (!refreshSuccess) {
        //       console.log("xeroRefreshAccessToken | Failed");
        //       functions.logger.info("AUTO REFRESH | FAILED - NO ACTION WAS PERFORMED TO XERO");
        //       await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "XERO-FAIL-REFRESH");
        //       await sendNodeMail(db, {
        //         title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //         message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //         action: "Your access to our service may have expired. You will need to re-authorize this service to your Xero Organization after 60 days of inactivity. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
        //       });

        //       response.status(401).send({
        //         error: "XERO-FAIL-REFRESH",
        //         messsage: "Failed to auto-refresh xero access token. Function terminated.",
        //       });
        //     } else {
        //       const retryResult = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
        //       const retryStatusCode = retryResult.statusCode;
        //       const retryBody = retryResult.body;
        //       const retryError = retryResult.error;

        //       if (retryStatusCode !== 200) {
        //         console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
        //         if (retryStatusCode === 403) {
        //           functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);

        //           await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "XERO-NEED-MANUAL-AUTH");
        //           await sendNodeMail(db, {
        //             title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //             message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //             action: "Xero-Firebase service requires manual authentication to your Xero Organization after our recent update. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
        //           });

        //           response.status(403).send({
        //             error: "XERO-NEED-MANUAL-AUTH",
        //             message: "This app is not authorized to connect with your organization. Please manually authorize this app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
        //           });

        //         } else {
        //           functions.logger.error("AUTO RETRY CREATE TRANSACTIONS | UNKOWN ERROR - NO ACTION WAS PERFORMED TO XERO API");
        //           functions.logger.error("Status code: " + retryStatusCode + "\nError: " + retryError + "\nBody: " + retryBody);
        //           await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "INTERNAL-SERVER-ERROR");
        //           await sendNodeMail(db, {
        //             title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //             message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //             action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
        //           });

        //           response.status(500).send({
        //             error: "INTERNAL-SERVER-ERROR",
        //             message: "Failed to retry creating bank transaction in Xero.",
        //           });
        //         }
        //       } else {
        //         console.log("Update transactions successful");
        //         functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | SUCCESSFUL");
        //         await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, true);

        //         response.status(200).send({
        //           message:
        //             "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
        //         });
        //       }
        //     }
        //     break;
        //   }

        //   case 403:
        //     console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
        //     functions.logger.info("CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);
        //     await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
        //     await sendNodeMail(db, {
        //       title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //       message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //       action: "Xero-Firebase service requires manual authentication to your Xero Organization after our recent update. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
        //     });

        //     response.status(403).send({
        //       error: "XERO-NEED-MANUAL-AUTH",
        //       message: "This app is not authorized to connect with your organization. Please manually authorize tihs app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
        //       action: NEW_FUNCTION_AUTH_URL,
        //     });
        //     break;

        //   case 500:
        //     console.log("xeroCreateBankTransactions | Failed with internal catch error: " + error);
        //     functions.logger.error("xeroCreateBankTransactions | Failed with internal catch error: " + error);
        //     await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
        //     await sendNodeMail(db, {
        //       title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //       message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //       action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
        //     });


        //     response.status(500).send({
        //       error: "INTERNAL-SERVER-ERROR",
        //       message: error + "\n\nNOTE: Please contact your Firebase Cloud Functions Developer at wong.zhengxiang@gmail.com.",
        //     });

        //     break;

        //   default:
        //     console.log("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
        //     functions.logger.error("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
        //     await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
        //     await sendNodeMail(db, {
        //       title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
        //       message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
        //       action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
        //     });


        //     response.status(statusCode).send({
        //       error: "XERO-ERROR",
        //       message: "NOTE: An error has occured while calling the XERO API. Your request has been terminated. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com." + "\n\nRESPONSE BODY FROM XERO:\n\n" + body,
        //     });
        // }


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

// SEND INIT EMAIL
exports.sendInitEmail = functions.https.onRequest(async (request, response) => {
  const { success, value, statusCode } = await sendInitMail(db);
  if (success) {
    response.status(200).send(value);
  } else {
    response.status(statusCode ?? 500).send(value);
  }
});

// SEND WEEKLY REPORT EMAIL - IN DEVELOPMENT
exports.sendWeeklyReportEmail = functions.https.onRequest(async (request, response) => {
  try {
    const { largestDate, smallestDate, message, numberOfTransactions, listOfNewTransactions } = await getListOfNewTransactions(db);

    if (numberOfTransactions == -1) {
      // CATCH ERROR in function
      console.log("sendWeeklyReportEmail | Failed: " + message);
      functions.logger.error("sendWeeklyReportEmail | Failed: " + message);
      response.status(500).send("Internal error has occured");
    }

    converter.json2csv(listOfNewTransactions, async (err, csv) => {
      console.log("converter json2csv | STARTED");
      if (err) {
        // Has error
        console.log("converter json2csv | FAILED: " + err);
        response.status(500).send("Failed to convert JSON to CSV: " + err);
        throw err;
      }

      if (!csv) {
        // Empty csv content
        console.log("converter json2csv | csv file is empty");
        response.status(500).send("CSV String is empty: " + csv);
        return;
      }

      // print CSV string
      console.log("CONVERTED CSV FILE IS:\n" + csv);
      fs.writeFileSync("current_report.csv", csv);
      console.log("writeFileSync | SUCESSS");

      // CONTINUE WITH FIREBASE STORAGE

      const { success, value } = await sendWeeklyReportMail(db, largestDate ?? "-", smallestDate ?? "-", numberOfTransactions);

      // DELETE TEMP FILE

      if (success) {
        console.log("HELPER.ts: sendWeeklyReportMail | SUCESSS");
        // UPDATE TRANSACTION LOGS
        response.status(200).send("sendWeeklyReportEmail | SUCCESS");
      } else {
        console.log("HELPER.ts: sendWeeklyReportMail | FAILED: " + value);
        functions.logger.error("HELPER.ts: sendWeeklyReportMail | FAILED: " + value);
        response.status(500).send("sendWeeklyReportEmail | FAILED");
      }
    });

  } catch (error) {
    console.log("sendWeeklyReportEmail | FAILED with catch error: " + error);
    functions.logger.error("sendWeeklyReportEmail | FAILED with catch error: " + error);
    response.status(500).send("sendWeeklyReportEmail | FAILED with catch error: " + error);
  }
});

// LATEST FUNCTION
// exports.xeroInputMain = functions.https.onRequest(async (request, response) => {
//   // inputXeroApi | this function should be called by WebHooks, parsing in the csvFile - POST

//   if (request.method !== "POST") {
//     response.status(405).send({
//       error: "METHOD-NOT-ALLOWED",
//       message: "You have sent an invalid response to this URL. Please use POST request instead.",
//     });
//     return;
//   }

//   // CODE NOT USED
//   // const { success, value, statusCode } = await validateBearerAuthToken(request, db);

//   // if (!success) {
//   //   console.log(value);
//   //   response.status(statusCode ?? 403).send(value?.toString());
//   //   return;
//   // }

//   // IP WHITELISTING NOT USED
//   // const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

//   // if (!resultIP.success) {
//   //   console.log(resultIP.value);
//   //   response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
//   //   return;
//   // }

//   const token = request.headers.authorization?.split(" ")[1];
//   console.log("verifyJwt | token is: " + token);
//   console.log("verifyJwt | body is: " + request.body);

//   if (token === undefined) {
//     response.status(403).send({
//       error: "MISSING-TOKEN",
//       message: "Could not find token in authorization header. Request rejected.",
//     });
//     return;
//   }

//   if (jwt_secret_key === undefined) {
//     response.status(500).send({
//       error: "INTERNAL-SERVER-ERROR",
//       message:
//         "Missing JSON Web Token secret key in our server. Please contact your Firebase Cloud Functions Developer at wong.zhengxiang@gmail.com.",
//     });
//     return;
//   }

//   jwt.verify(token, jwt_secret_key, { algorithms: ["HS256"] }, async function (error, decoded) {
//     if (error) {
//       // invalid token - reject request
//       response.status(403).send({
//         error: "JWT-VERIFY-ERROR",
//         message: error.message,
//       });
//       return;
//     } else {
//       if (decoded?.id && request.body.id && decoded?.id === request.body.id) {
//         // payment id is a match - jwt payload && request.body

//         console.log("\nJWT VERIFY FLOW SUCCESS! PAYLOAD ID MATCHED.\n");

//         const listOfFormattedTransactions: XeroTransactionObject[] = [];
//         const transaction: Record<string, string> = request.body;
//         // FUTURE IMPLEMENTATION - request body may hold a list of transactions

//         console.log("PAYLOAD TEST | Name: " + transaction.name);
//         console.log("PAYLOAD TEST | Email: " + transaction.email);
//         console.log("PAYLOAD TEST | Date: " + transaction.transaction_date);

//         functions.logger.info("PAYLOAD DATA: " + JSON.stringify(transaction));

//         const xeroTransactionObject: XeroTransactionObject = {
//           "Type": "RECEIVE",
//           "Reference": transaction.remarks + " | iPay88",
//           "Date": transaction.transaction_date,
//           "CurrencyCode": transaction.currency,
//           "Contact": {
//             "Name": transaction.name,
//             "EmailAddress": transaction.email ?? transaction.student_email,
//             "Phones": [
//               {
//                 "PhoneType": "MOBILE",
//                 "PhoneNumber": transaction.phone,
//               },
//             ],
//             "BankAccountDetails": "iPay88" + " | " + transaction.ip_s_bankname,
//           },
//           "LineItems": [
//             {
//               "Description": transaction.remarks + " | iPay88 transaction ID: " + transaction.ip_transid,
//               // "ItemCode": transaction.id,
//               "Quantity": 1.0,
//               "UnitAmount": transaction.ip_amount,
//               "AccountCode": "404",

//             },
//           ],
//           "BankAccount": {
//             "Code": "090",
//           },
//         };

//         listOfFormattedTransactions.push(xeroTransactionObject);

//         const compiledXeroJson = {
//           "bankTransactions": listOfFormattedTransactions,
//         };

//         const resultOTP = await generateFirebaseOTP(db);

//         const NEW_FUNCTION_AUTH_URL = FUNCTION_AUTH_URL + "?code=" + resultOTP;

//         const { statusCode, body, error } = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

//         switch (statusCode) {
//           case 200:
//             console.log("Update transactions successful");
//             functions.logger.info("UDPATE TRANSACTION SUCCESSFUL");
//             // May want to redirect to webpage with UI explanation - IF SUCCESS 200

//             await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, true);

//             response.status(200).send({
//               message: "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
//             });

//             break;

//           case 401: {
//             const refreshSuccess = await xeroRefreshAccessToken(db);
//             if (!refreshSuccess) {
//               console.log("xeroRefreshAccessToken | Failed");
//               functions.logger.info("AUTO REFRESH | FAILED - NO ACTION WAS PERFORMED TO XERO");
//               await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "XERO-FAIL-REFRESH");
//               await sendNodeMail(db, {
//                 title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//                 message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//                 action: "Your access to our service may have expired. You will need to re-authorize this service to your Xero Organization after 60 days of inactivity. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
//               });

//               response.status(401).send({
//                 error: "XERO-FAIL-REFRESH",
//                 messsage: "Failed to auto-refresh xero access token. Function terminated.",
//               });
//             } else {
//               const retryResult = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
//               const retryStatusCode = retryResult.statusCode;
//               const retryBody = retryResult.body;
//               const retryError = retryResult.error;

//               if (retryStatusCode !== 200) {
//                 console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
//                 if (retryStatusCode === 403) {
//                   functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);

//                   await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "XERO-NEED-MANUAL-AUTH");
//                   await sendNodeMail(db, {
//                     title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//                     message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//                     action: "Xero-Firebase service requires manual authentication to your Xero Organization after our recent update. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
//                   });

//                   response.status(403).send({
//                     error: "XERO-NEED-MANUAL-AUTH",
//                     message: "This app is not authorized to connect with your organization. Please manually authorize this app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
//                   });

//                 } else {
//                   functions.logger.error("AUTO RETRY CREATE TRANSACTIONS | UNKOWN ERROR - NO ACTION WAS PERFORMED TO XERO API");
//                   functions.logger.error("Status code: " + retryStatusCode + "\nError: " + retryError + "\nBody: " + retryBody);
//                   await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false, "INTERNAL-SERVER-ERROR");
//                   await sendNodeMail(db, {
//                     title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//                     message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//                     action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
//                   });

//                   response.status(500).send({
//                     error: "INTERNAL-SERVER-ERROR",
//                     message: "Failed to retry creating bank transaction in Xero.",
//                   });
//                 }
//               } else {
//                 console.log("Update transactions successful");
//                 functions.logger.info("AUTO RETRY CREATE TRANSACTIONS | SUCCESSFUL");
//                 await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, true);

//                 response.status(200).send({
//                   message:
//                     "UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson),
//                 });
//               }
//             }
//             break;
//           }

//           case 403:
//             console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
//             functions.logger.info("CREATE TRANSACTIONS | FAILED - APP IS UNAUTHORIZED, NEED MANUAL AUTH. LINK: \n" + NEW_FUNCTION_AUTH_URL);
//             await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
//             await sendNodeMail(db, {
//               title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//               message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//               action: "Xero-Firebase service requires manual authentication to your Xero Organization after our recent update. Please follow the steps in this link to authorize Xero-Firebase service to your Xero Organization: " + NEW_FUNCTION_AUTH_URL,
//             });

//             response.status(403).send({
//               error: "XERO-NEED-MANUAL-AUTH",
//               message: "This app is not authorized to connect with your organization. Please manually authorize tihs app to connect with your Xero Organization here:\n" + NEW_FUNCTION_AUTH_URL,
//               action: NEW_FUNCTION_AUTH_URL,
//             });
//             break;

//           case 500:
//             console.log("xeroCreateBankTransactions | Failed with internal catch error: " + error);
//             functions.logger.error("xeroCreateBankTransactions | Failed with internal catch error: " + error);
//             await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
//             await sendNodeMail(db, {
//               title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//               message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//               action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
//             });


//             response.status(500).send({
//               error: "INTERNAL-SERVER-ERROR",
//               message: error + "\n\nNOTE: Please contact your Firebase Cloud Functions Developer at wong.zhengxiang@gmail.com.",
//             });

//             break;

//           default:
//             console.log("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
//             functions.logger.error("xeroCreateBankTransactions | Failed with internal XERO error:\n" + body);
//             await generateTransactionLog(db, admin.firestore.FieldValue.serverTimestamp(), transaction, false);
//             await sendNodeMail(db, {
//               title: "ALERT: Failed to create bank transaction line in your Xero Organization from <Xero-Firebase-Service>",
//               message: "ID: " + transaction.id + "\niPay88 Transaction ID: " + transaction.ip_transid + "\n\nYou received this email because a transaction line has failed to be created in your Xero bank account.",
//               action: "We have identified an issue on our end. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com.",
//             });


//             response.status(statusCode).send({
//               error: "XERO-ERROR",
//               message: "NOTE: An error has occured while calling the XERO API. Your request has been terminated. Please contact your Firebase Cloud Functions developer at wong.zhengxiang@gmail.com." + "\n\nRESPONSE BODY FROM XERO:\n\n" + body,
//             });
//         }


//       } else {
//         console.log("\nJWT VERIFY FAILED because payload ID mismatched\n");
//         functions.logger.error("\nJWT VERIFY FAILED because payload ID mismatched\n");
//         response.status(403).send({
//           error: "MISMATCHED-PAYLOAD",
//           message:
//             "Your JSON Web Token decoded payload does not match with your request body. Request rejected",
//         });
//         return;
//       }
//     }
//   });
// });

