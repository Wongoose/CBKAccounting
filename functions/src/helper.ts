import * as Papa from "papaparse";
import nodeRequest = require("request");
import { promisify } from "util";
import config from "./config/config";
import base64 = require("base-64");
import fs = require("fs");
import * as functions from "firebase-functions";
import jwt = require("jsonwebtoken");
import nodeMailer = require("nodemailer");

const { client_id, client_secret, gmailEmail, gmailPassword } = config;

const XERO_BANK_TRANSACTIONS_URL = "https://api.xero.com/api.xro/2.0/BankTransactions";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_TENANT_CONNECTIONS_URL = "https://api.xero.com/connections";

export const post = promisify(nodeRequest.post);
export const get = promisify(nodeRequest.get);

export type XeroTransactionObject = {
  Type: string;
  Reference: string;
  Date: string;
  CurrencyCode: string;
  Contact: {
    Name: string;
    EmailAddress: string;
    Phones: {
      PhoneType: string;
      PhoneNumber: string;
    }[];
    BankAccountDetails: string;
  };
  LineItems: Record<string, unknown>[];
  BankAccount: Record<string, unknown>;
}

export type XeroParameters = {
  client_id: string | undefined;
  client_secret: string | undefined,
  access_token?: string,
  refresh_token?: string,
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
}

export type ReturnValue = {
  success: boolean, value: string | jwt.JwtPayload | undefined, statusCode?: number,
}

export const xeroCreateBankTransaction = async (
  firestore: FirebaseFirestore.Firestore,
  transactions: XeroTransactionObject[]
) => {
  try {
    console.log("\nSTART OF xeroCreateBankTransaction:\n");

    const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) throw Error("Access Token or Xero Tenant ID not found");

    const accessToken = dataMap["access_token"];
    const xeroTenantId = dataMap["xero-tenant-id"];

    const requestBody = { bankTransactions: transactions };
    const { statusCode, body } = await post({
      url: XERO_BANK_TRANSACTIONS_URL,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + accessToken,
        "Xero-Tenant-Id": xeroTenantId,
      },
      body: JSON.stringify(requestBody),
    });

    console.log("xeroCreateBankTransaction | statusCode:", statusCode);
    // console.log("xeroCreateBankTransaction | body:", body != null);
    console.log("xeroCreateBankTransaction | body:", body);

    return { statusCode, body, error: null };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: null, error };
  }
};

export const xeroRefreshAccessToken = async (
  firestore: FirebaseFirestore.Firestore,
) => {
  try {

    console.log("\nSTART OF xeroRefresh:\n");

    const cbkAccountingCollection = firestore.collection("CBKAccounting");
    const doc = await cbkAccountingCollection.doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) throw Error("Access Token or Refresh Token not found");

    const accessToken = dataMap["access_token"];
    const refreshToken = dataMap["refresh_token"];

    const params: XeroParameters = {
      client_id: client_id,
      client_secret: client_secret,
      access_token: accessToken,
      refresh_token: refreshToken,
    };

    const { statusCode, body } = await post({
      method: "POST",
      url: XERO_TOKEN_URL,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + base64.encode(`${params.client_id}:${params.client_secret}`),
      },
      body: `grant_type=refresh_token&refresh_token=${params.refresh_token}`,
    });

    console.log("xeroRefreshAPI | statusCode:", statusCode);
    const { access_token, refresh_token } = JSON.parse(body);

    await cbkAccountingCollection.doc("tokens").update({ access_token, refresh_token });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const xeroGetTenantConnections = async (
  firestore: FirebaseFirestore.Firestore,
  accessToken: string,) => {
  try {

    console.log("\nSTART OF xeroGetTenantConnections:\n");

    const cbkAccountingCollection = firestore.collection("CBKAccounting");

    const { statusCode, body } = await get({
      url: XERO_TENANT_CONNECTIONS_URL,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
    });

    console.log("xeroGetTenantConnections | statusCode:", statusCode);
    console.log("xeroGetTenantConnections | body:", body);

    if (statusCode === 200) {
      const firstTenantJSON: Record<string, string> = (JSON.parse(body))[0];
      const xeroTenantId = firstTenantJSON["tenantId"];
      console.log("xeroGetTenantConnections | Tenant ID is: " + xeroTenantId);
      cbkAccountingCollection.doc("tokens").update({
        "xero-tenant-id": xeroTenantId,
      });
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
};

export const readCSV = async (filePath: fs.PathOrFileDescriptor) => {
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

export const validateBearerAuthToken = async (request: functions.https.Request, firestore: FirebaseFirestore.Firestore): Promise<ReturnValue> => {

  try {
    const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: Cannot read database.", statusCode: 500 };
      return result;
    }

    const bearerToken = dataMap["bearer_token"];

    let authorizationToken: string | undefined;
    if (!request.headers.authorization || !request.headers.authorization.startsWith("Bearer ")) {
      const result: ReturnValue = { success: false, value: "UNAUTHORIZED: You are not authorized to trigger this function. Please parse in your authorization token in your request header." };
      return result;
    }

    if (request.headers.authorization && request.headers.authorization.startsWith("Bearer ")) {
      console.log("Found 'Authorization' header");
      authorizationToken = request.headers.authorization.split("Bearer ")[1];

      // validate token from firebase
      if (authorizationToken == bearerToken) {
        console.log("VALID AUTHORIZATION TOKEN IN HEADER");
        const result: ReturnValue = { success: true, value: authorizationToken };
        return result;

      } else {
        console.log("INVALID AUTHORIZATION TOKEN IN HEADER");
        const result: ReturnValue = { success: false, value: "UNAUTHORIZED: You are not authorized to trigger this function. Your authorization token is invalid." };
        return result;
      }
    } else if (request.cookies) {
      console.log("Found '__session' cookie");
      authorizationToken = request.cookies.__session;
      const result: ReturnValue = { success: true, value: authorizationToken };
      return result;
    } else {
      const result: ReturnValue = { success: false, value: "UNAUTHORIZED: You are not authorized to trigger this function. Please parse in your authorization token in your request header." };
      return result;
    }
  } catch (error) {
    const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: An error has occured on our end. No action was perfomed.", statusCode: 500 };
    return result;
  }
};

export const validateIpAddress = async (ip: string, firestore: FirebaseFirestore.Firestore): Promise<ReturnValue> => {
  try {
    const doc = await firestore.collection("CBKAccounting").doc("details").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: Cannot read database.", statusCode: 500 };
      return result;
    }

    const listOfWhiteListedIps: string[] | undefined = dataMap["whitelisted_ip"];
    if (listOfWhiteListedIps) {
      if (listOfWhiteListedIps.includes(ip)) {
        const result: ReturnValue = { success: true, value: "Valid access." };
        return result;
      } else {
        const result: ReturnValue = { success: false, value: "INVALID ACCESS: You do not have access to this url." };
        return result;
      }
    } else {
      const result: ReturnValue = { success: false, value: "INVALID ACCESS: You do not have access to this url." };
      return result;
    }
  } catch (error) {
    const result: ReturnValue = { success: false, value: ("INTERNAL SERVER ERROR: " + error), statusCode: 500 };
    return result;
  }

};

export const generateFirebaseOTP = async (firestore: FirebaseFirestore.Firestore): Promise<string> => {
  const newOTP = Math.floor(100000 + Math.random() * 900000).toString();

  firestore.collection("CBKAccounting").doc("details").update({ "otp": newOTP });

  return newOTP;

};

export const generateTransactionLog = async (firestore: FirebaseFirestore.Firestore, timestamp: FirebaseFirestore.FieldValue, transaction: Record<string, any>, success: boolean, error?: string): Promise<ReturnValue> => {
  try {
    // add time stamp
    console.log("Generating logs...");
    transaction["xero_success"] = success.toString();
    transaction["log_error"] = error ?? "";


    const getExistingLogSnap = await firestore.collection("transactionLogs").where("ip_transid", "==", transaction.ip_transid).get();
    if (getExistingLogSnap.docs.length == 0) {
      // no existing logs - create new
      console.log("Creating new log...");

      const addResult = await firestore.collection("transactionLogs").add(transaction);

      if (!addResult.id) {
        const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: Cannot add log to database.", statusCode: 500 };
        return result;
      } else {
        await firestore.collection("transactionLogs").doc(addResult.id).update({
          "log_created": timestamp,
          "log_updated": timestamp,
        });
        const result: ReturnValue = { success: true, value: addResult.id };
        return result;
      }

    } else {
      console.log("Updating existing log...");
      const docID = getExistingLogSnap.docs[0].id;
      const updateResult = await firestore.collection("transactionLogs").doc(docID).update(transaction);

      if (updateResult) {
        await firestore.collection("transactionLogs").doc(docID).update({
          "log_updated": timestamp,
        });
        const result: ReturnValue = { success: true, value: docID };
        return result;
      } else {
        const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: Cannot update log to database.", statusCode: 500 };
        return result;
      }
    }

  } catch (error) {
    console.log("generateLogs | Failed with catch error: " + error);
    const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: Cannot read database.", statusCode: 500 };
    return result;
  }
};

// export const sendEmail = async () => {
//   try {
//     console.log("Sending email...");
//     if (!sendgrid_api_key) {
//       // internal error no api key
//       console.log("INTERNAL SERVER ERROR: No sendgrod_api_key found!");
//       return;
//     }
//     sgMail.setApiKey(sendgrid_api_key);

//     const msg = {
//       to: "wong.zhengxiang@gmail.com",
//       from: "wongoose.developer@gmail.com",
//       subject: "Sending with SendGrid is Fun",
//       text: "and easy to do anywhere, even with Node.js",
//     };

//     sgMail.send(msg).then((response) => {
//       console.log("SENT EMAIL VIA SEND GRID");
//     }).catch((err) => {
//       console.log("FAILED TO SEND EMAIL: " + err);
//     });

//   } catch (error) {
//     console.log("FAILED TO SEND EMAIL with catch error: " + error);
//     return;
//   }
// };
type NodeMailDetails = {
  title: string;
  message: string;
  action: string;
};

export const sendNodeMail = async (firestore: FirebaseFirestore.Firestore, mailMap: NodeMailDetails) => {
  try {
    console.log("NODEMAILER running...");

    const doc = await firestore.collection("CBKAccounting").doc("details").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      console.log("sendNodeMail | Failed");
      return;
    }

    const adminEmail = dataMap["admin_email"];

    const transporter = nodeMailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailEmail,
        pass: gmailPassword,
      },
    });

    const mailOptions = {
      from: "Support from CBKAccounting",
      to: adminEmail,
      subject: mailMap.title,
      text: "FAILED TRANSACTION DETAILS:\n" + mailMap.message + "\n\nFIX:\n" + mailMap.action,
    };

    await transporter.sendMail(mailOptions);
    console.log("SENT EMAIL VIA NODEMAILER");
  } catch (error) {
    console.log("FAILED TO SEND EMAIL with catch error: " + error);
  }

};

export const sendInitMail = async (firestore: FirebaseFirestore.Firestore) => {
  try {
    console.log("INITMAIL running...");

    const doc = await firestore.collection("CBKAccounting").doc("details").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      console.log("sendNodeMail | Failed");
      return;
    }

    const adminEmail = dataMap["admin_email"];

    const transporter = nodeMailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailEmail,
        pass: gmailPassword,
      },
    });

    const mailOptions = {
      from: "Support from CBKAccounting",
      to: adminEmail,
      subject: "TO-DO: Beginning of Xero-Firebase service",
      text: "Please mark this email as NOT SPAM to receive notifications in the future.",
    };

    await transporter.sendMail(mailOptions);
    console.log("SENT EMAIL VIA NODEMAILER");
    return;
  } catch (error) {
    console.log("FAILED TO SEND INITEMAIL with catch error: " + error);
    return;

  }
};