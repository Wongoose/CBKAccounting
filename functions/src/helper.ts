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

const XERO_BANK_TRANSACTIONS_URL =
  "https://api.xero.com/api.xro/2.0/BankTransactions";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_TENANT_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";

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
};

export type XeroParameters = {
  client_id: string | undefined;
  client_secret: string | undefined;
  access_token?: string;
  refresh_token?: string;
  redirect_uri?: string;
  response_type?: string;
  scope?: string;
  state?: string;
};

export type ReturnValue = {
  success: boolean;
  value: string | jwt.JwtPayload | undefined;
  statusCode?: number;
};

export const xeroCreateBankTransaction = async (
  firestore: FirebaseFirestore.Firestore,
  transactions: XeroTransactionObject[]
) => {
  try {
    console.log("\nSTART OF xeroCreateBankTransaction:\n");

    const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      throw Error("Access Token or Xero Tenant ID not found");
    }

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
  firestore: FirebaseFirestore.Firestore
) => {
  try {
    console.log("\nSTART OF xeroRefresh:\n");

    const cbkAccountingCollection = firestore.collection("CBKAccounting");
    const doc = await cbkAccountingCollection.doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      throw Error("Access Token or Refresh Token not found");
    }

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
        "Authorization":
          "Basic " +
          base64.encode(`${params.client_id}:${params.client_secret}`),
      },
      body: `grant_type=refresh_token&refresh_token=${params.refresh_token}`,
    });

    console.log("xeroRefreshAPI | statusCode:", statusCode);
    const { access_token, refresh_token } = JSON.parse(body);

    await cbkAccountingCollection
      .doc("tokens")
      .update({ access_token, refresh_token });
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
};

export const xeroGetTenantConnections = async (
  firestore: FirebaseFirestore.Firestore,
  accessToken: string
) => {
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
      const firstTenantJSON: Record<string, string> = JSON.parse(body)[0];
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

export const xeroGetListOfInvoices = async (
  firestore: FirebaseFirestore.Firestore,
  pageNumber: string,
  orderDate: string,
  searchName: string | null
): Promise<ReturnValue> => {
  try {
    console.log("\nSTART OF xeroGetListOfInvoices:\n");

    const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      const result: ReturnValue = {
        success: false,
        value: "INTERNAL SERVER ERROR: Cannot read database.",
        statusCode: 500,
      };
      return result;
    }

    const accessToken = dataMap["access_token"];
    const xeroTenantId = dataMap["xero-tenant-id"];

    // FORMATTING THE URL
    const formatUrl: URL = new URL(XERO_INVOICES_URL);
    formatUrl.searchParams.append("page", pageNumber);
    formatUrl.searchParams.append("order", `Date ${orderDate}`);

    if (searchName) {
      formatUrl.searchParams.append("where", `Contact.Name=="${searchName}"`);
    }

    const { statusCode, body } = await get({
      url: formatUrl.toString(),
      // url: `${XERO_INVOICES_URL}?page=${pageNumber}&order=Date%20${orderDate}`,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
      },
    });

    console.log("xeroGetListOfInvoices | statusCode:", statusCode);
    console.log("xeroGetListOfInvoices | body length:", JSON.parse(body));

    if (statusCode === 200) {
      const listOfInvoices: Record<string, string> = JSON.parse(body).Invoices;
      console.log("xeroGetListOfInvoices | List of invoices success");
      const result: ReturnValue = {
        success: true,
        value: listOfInvoices,
        statusCode,
      };
      return result;
    } else {
      const result: ReturnValue = {
        success: false,
        value: JSON.parse(body),
        statusCode: statusCode ?? body.Status,
      };
      return result;
    }
  } catch (error) {
    const result: ReturnValue = {
      success: false,
      value: `Catch error: ${error}`,
      statusCode: 500,
    };
    return result;
  }
};

export const readCSV = async (filePath: fs.PathOrFileDescriptor) => {
  const csvFile = fs.readFileSync(filePath);
  const csvData = csvFile.toString();
  return new Promise<Record<string, string>[]>((resolve, reject) => {
    try {
      Papa.parse(csvData, {
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

export const validateBearerAuthToken = async (
  request: functions.https.Request,
  firestore: FirebaseFirestore.Firestore
): Promise<ReturnValue> => {
  try {
    const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      const result: ReturnValue = {
        success: false,
        value: "INTERNAL SERVER ERROR: Cannot read database.",
        statusCode: 500,
      };
      return result;
    }

    const bearerToken = dataMap["bearer_token"];

    let authorizationToken: string | undefined;
    if (
      !request.headers.authorization ||
      !request.headers.authorization.startsWith("Bearer ")
    ) {
      const result: ReturnValue = {
        success: false,
        value:
          "UNAUTHORIZED: You are not authorized to trigger this function. Please parse in your authorization token in your request header.",
      };
      return result;
    }

    if (
      request.headers.authorization &&
      request.headers.authorization.startsWith("Bearer ")
    ) {
      console.log("Found 'Authorization' header");
      authorizationToken = request.headers.authorization.split("Bearer ")[1];

      // validate token from firebase
      if (authorizationToken == bearerToken) {
        console.log("VALID AUTHORIZATION TOKEN IN HEADER");
        const result: ReturnValue = {
          success: true,
          value: authorizationToken,
        };
        return result;
      } else {
        console.log("INVALID AUTHORIZATION TOKEN IN HEADER");
        const result: ReturnValue = {
          success: false,
          value:
            "UNAUTHORIZED: You are not authorized to trigger this function. Your authorization token is invalid.",
        };
        return result;
      }
    } else if (request.cookies) {
      console.log("Found '__session' cookie");
      authorizationToken = request.cookies.__session;
      const result: ReturnValue = { success: true, value: authorizationToken };
      return result;
    } else {
      const result: ReturnValue = {
        success: false,
        value:
          "UNAUTHORIZED: You are not authorized to trigger this function. Please parse in your authorization token in your request header.",
      };
      return result;
    }
  } catch (error) {
    const result: ReturnValue = {
      success: false,
      value:
        "INTERNAL SERVER ERROR: An error has occured on our end. No action was perfomed.",
      statusCode: 500,
    };
    return result;
  }
};

export const validateIpAddress = async (
  ip: string,
  firestore: FirebaseFirestore.Firestore
): Promise<ReturnValue> => {
  try {
    const doc = await firestore
      .collection("CBKAccounting")
      .doc("details")
      .get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      const result: ReturnValue = {
        success: false,
        value: "INTERNAL SERVER ERROR: Cannot read database.",
        statusCode: 500,
      };
      return result;
    }

    const listOfWhiteListedIps: string[] | undefined =
      dataMap["whitelisted_ip"];
    if (listOfWhiteListedIps) {
      if (listOfWhiteListedIps.includes(ip)) {
        const result: ReturnValue = { success: true, value: "Valid access." };
        return result;
      } else {
        const result: ReturnValue = {
          success: false,
          value: "INVALID ACCESS: You do not have access to this url.",
        };
        return result;
      }
    } else {
      const result: ReturnValue = {
        success: false,
        value: "INVALID ACCESS: You do not have access to this url.",
      };
      return result;
    }
  } catch (error) {
    const result: ReturnValue = {
      success: false,
      value: "INTERNAL SERVER ERROR: " + error,
      statusCode: 500,
    };
    return result;
  }
};

export const generateFirebaseOTP = async (
  firestore: FirebaseFirestore.Firestore
): Promise<string> => {
  const newOTP = Math.floor(100000 + Math.random() * 900000).toString();

  firestore.collection("CBKAccounting").doc("details").update({ otp: newOTP });

  return newOTP;
};

export const generateTransactionLog = async (
  firestore: FirebaseFirestore.Firestore,
  timestamp: FirebaseFirestore.FieldValue,
  transaction: Record<string, any>,
  success: boolean,
  error?: string
): Promise<ReturnValue> => {
  try {
    // add time stamp
    console.log("Generating logs...");
    transaction["xero_success"] = success.toString();
    transaction["log_error"] = error ?? "";

    const getExistingLogSnap = await firestore
      .collection("transactionLogs")
      .where("ip_transid", "==", transaction.ip_transid)
      .get();

    if (getExistingLogSnap.docs.length == 0) {
      // no existing logs - create new
      console.log("Creating new log...");

      const addResult = await firestore
        .collection("transactionLogs")
        .add(transaction);

      if (!addResult.id) {
        const result: ReturnValue = {
          success: false,
          value: "INTERNAL SERVER ERROR: Cannot add log to database.",
          statusCode: 500,
        };
        return result;
      } else {
        await firestore.collection("transactionLogs").doc(addResult.id).update({
          log_created: timestamp,
          log_updated: timestamp,
          isEmailed: false,
          isReconciled: false,
          listOfReconciledInvoiceIDs: [],
        });
        const result: ReturnValue = { success: true, value: addResult.id };
        return result;
      }
    } else {
      console.log("Updating existing log...");
      const docID = getExistingLogSnap.docs[0].id;
      const updateResult = await firestore
        .collection("transactionLogs")
        .doc(docID)
        .update(transaction);

      if (updateResult) {
        await firestore.collection("transactionLogs").doc(docID).update({
          log_updated: timestamp,
          // "isEmailed": false,
        });
        const result: ReturnValue = { success: true, value: docID };
        return result;
      } else {
        const result: ReturnValue = {
          success: false,
          value: "INTERNAL SERVER ERROR: Cannot update log to database.",
          statusCode: 500,
        };
        return result;
      }
    }
  } catch (error) {
    console.log("generateLogs | Failed with catch error: " + error);
    const result: ReturnValue = {
      success: false,
      value: "INTERNAL SERVER ERROR: Cannot read database.",
      statusCode: 500,
    };
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

export const sendNodeMail = async (
  firestore: FirebaseFirestore.Firestore,
  mailMap: NodeMailDetails
) => {
  try {
    console.log("NODEMAILER running...");

    const doc = await firestore
      .collection("CBKAccounting")
      .doc("details")
      .get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      console.log("sendNodeMail | Failed");
      return;
    }

    const adminEmail = dataMap["admin_email"];
    const emailEnabled = dataMap["email_enabled"];

    if (!emailEnabled) {
      return;
    }

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
      text:
        "FWhat happened?\n" + mailMap.message + "\n\nFIX:\n" + mailMap.action,
    };

    await transporter.sendMail(mailOptions);
    console.log("SENT EMAIL VIA NODEMAILER");
  } catch (error) {
    console.log("FAILED TO SEND EMAIL with catch error: " + error);
  }
};

export const sendInitMail = async (
  firestore: FirebaseFirestore.Firestore
): Promise<ReturnValue> => {
  try {
    console.log("INITMAIL running...");

    const doc = await firestore
      .collection("CBKAccounting")
      .doc("details")
      .get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      console.log("sendNodeMail | Failed");
      const result: ReturnValue = {
        success: false,
        value: "Failed to read data from database",
        statusCode: 500,
      };
      return result;
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
    const result: ReturnValue = {
      success: true,
      value: "Successful send init email",
    };
    return result;
  } catch (error) {
    console.log("FAILED TO SEND INITEMAIL with catch error: " + error);
    const result: ReturnValue = { success: false, value: "Failed: " + error };
    return result;
  }
};

// IN DEVELOPMENT
export const sendWeeklyReportMail = async (
  firestore: FirebaseFirestore.Firestore,
  largestDate: string,
  smallestDate: string,
  currentDate: string,
  numberOfTransactions: number,
  filePath: string
): Promise<ReturnValue> => {
  try {
    console.log("HELPER.ts: sendWeeklyReportMail Function running...");

    const doc = await firestore
      .collection("CBKAccounting")
      .doc("details")
      .get();
    const dataMap = doc.data();

    if (dataMap === undefined) {
      console.log("HELPER.ts: sendWeeklyReportMail | Failed");
      const result: ReturnValue = {
        success: false,
        value: "Failed to read data from database",
        statusCode: 500,
      };
      return result;
    }

    const adminEmail = dataMap["admin_email"];
    const listOfCcEmails = dataMap["cc_emails"] as string[];

    listOfCcEmails.push(adminEmail);

    const formattedcurrentDate = `${currentDate} (${
      new Date(currentDate).toString().split(" ")[0]
    })`;
    // const UTC8MillisecondOffset = 8 * 60 * 60 * 1000;
    // const currentDate = new Date(new Date().getTime() + UTC8MillisecondOffset).toISOString().split("T")[0];
    const lastReportedDate = dataMap["last_reported_date"];
    let formattedLastReportedDate;

    if (lastReportedDate == null) {
      formattedLastReportedDate = "(Start)";
    } else {
      formattedLastReportedDate = `${lastReportedDate} (${
        new Date(lastReportedDate).toString().split(" ")[0]
      })`;
    }

    const transporter = nodeMailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailEmail,
        pass: gmailPassword,
      },
    });

    let emailBody: string;

    if (numberOfTransactions == 0) {
      emailBody = `Here is a weekly report of the new ipay88 transactions.\n\nThis session duration: ${formattedLastReportedDate} to ${formattedcurrentDate}\nNumber of new ipay88 transactions: ${numberOfTransactions}\n\nThere are no new ipay88 transactions since the last reporting date. Thank you for using our service!`;
    } else {
      emailBody = `Here is a weekly report of the new ipay88 transactions.\n\nThis session duration: ${formattedLastReportedDate} to ${formattedcurrentDate}\nNumber of new ipay88 transactions: ${numberOfTransactions}\nSession's most recent ipay88 transaction date: ${largestDate} (${
        new Date(largestDate).toString().split(" ")[0]
      })\n\nWe have recorded all the new ipay88 transactions since the last reporting session into the CSV File attached below. Please manually import the CSV File to your Xero Bank Account. Thank you for using our service!`;
    }

    const mailOptions = {
      from: "Support from CBKAccounting",
      to: listOfCcEmails,
      subject: "Weekly transactions report from Xero-Firebase Service",
      text: emailBody,
      attachments: [
        {
          filename: `${currentDate} (ipay88).csv`,
          contentType: "application/vnd.ms-excel",
          content: fs.createReadStream(filePath),
        },
      ],
    };

    await transporter.sendMail(mailOptions);
    console.log("SENT EMAIL VIA NODEMAILER");
    await firestore.collection("CBKAccounting").doc("details").update({
      last_reported_date: currentDate,
    });

    const result: ReturnValue = {
      success: true,
      value: "Successful send weekly report email",
    };
    return result;
  } catch (error) {
    console.log(
      "HELPER.ts: sendWeeklyReportMail | FAILED with catch error: " + error
    );
    const result: ReturnValue = { success: false, value: error as string };
    return result;
  }
};

type ReturnNewTransaction = {
  largestDate?: string;
  smallestDate?: string;
  message?: string;
  listOfDocumentIds?: string[];
  numberOfTransactions: number;
  listOfNewTransactions: Record<string, any>[];
};

export const getListOfNewTransactions = async (
  firestore: FirebaseFirestore.Firestore
): Promise<ReturnNewTransaction> => {
  try {
    console.log("getListofNewTransactions running...");

    const snapshot = await firestore
      .collection("transactionLogs")
      .where("isEmailed", "in", [false, null])
      .get();
    const listOfNewTransactions: Record<string, any>[] = [];
    const listOfDocumentIds: string[] = [];
    const numberOfTransactions = snapshot.docs.length;
    let largestDateMillisecond: number;
    let smallestDateMillisecond: number;
    let largestDate: string | undefined = undefined;
    let smallestDate: string | undefined = undefined;

    if (snapshot.docs.length == 0) {
      // no new transactions in Firebase transactionLogs
      const result: ReturnNewTransaction = {
        numberOfTransactions,
        listOfNewTransactions: [],
      };
      return result;
    }

    snapshot.docs.forEach((doc) => {
      const dataMap = doc.data();

      const date = (dataMap["transaction_date"] as string).split(" ")[0];
      const listOfDateData = date.split("-");
      const year = listOfDateData[0];
      const month = listOfDateData[1];
      const day = listOfDateData[2];

      const formattedDate = `${day}/${month}/${year}`;

      if (!largestDateMillisecond && !smallestDateMillisecond) {
        largestDateMillisecond = Date.parse(date);
        smallestDateMillisecond = Date.parse(date);
        largestDate = new Date(largestDateMillisecond)
          .toISOString()
          .split("T")[0];
        smallestDate = new Date(largestDateMillisecond)
          .toISOString()
          .split("T")[0];
      } else {
        if (Date.parse(date) > largestDateMillisecond) {
          largestDateMillisecond = Date.parse(date);
          largestDate = new Date(largestDateMillisecond)
            .toISOString()
            .split("T")[0];
        } else if (Date.parse(date) < smallestDateMillisecond) {
          smallestDateMillisecond = Date.parse(date);
          smallestDate = new Date(largestDateMillisecond)
            .toISOString()
            .split("T")[0];
        }
      }

      const formattedJSON: Record<string, any> = {
        "*Date": formattedDate,
        "*Amount": dataMap["ip_amount"],
        "Payee": `${dataMap["name"]} (${
          dataMap["email"] ?? dataMap["phone"] ?? "none"
        })`,
        "Description": `${dataMap["schedule_id"]}, ${
          dataMap["remarks"] ?? "no remarks"
        }`,
        "Reference": "",
        "Transaction Id": dataMap["ip_transid"],
        "Transaction Type": "credit",
      };

      console.log("FORMATTED JSON:\n" + JSON.stringify(formattedJSON));
      listOfDocumentIds.push(doc.id);
      listOfNewTransactions.push(formattedJSON);
    });

    const result: ReturnNewTransaction = {
      largestDate,
      smallestDate,
      numberOfTransactions,
      listOfNewTransactions,
      listOfDocumentIds,
    };
    return result;
  } catch (error) {
    console.log("getListofNewTransactions | FAILED with catch error: " + error);
    const result: ReturnNewTransaction = {
      message: error as string,
      numberOfTransactions: -1,
      listOfNewTransactions: [],
    };
    return result;
  }
};

export const weeklyReportSuccessUpdate = async (
  firestore: FirebaseFirestore.Firestore,
  documentIds: string[],
  csvFileName: string,
  storageUrl: string,
  timestamp: FirebaseFirestore.FieldValue
) => {
  try {
    documentIds.forEach(async (docID) => {
      await firestore.collection("transactionLogs").doc(docID).update({
        isEmailed: true,
        csvFileName: csvFileName,
        storageUrl: storageUrl,
        log_updated: timestamp,
      });
    });
    return true;
  } catch (error) {
    console.log(
      "weeklyReportSuccessUpdate | FAILED with catch error: " + error
    );
    return false;
  }
};

export const convertFromFBTimestamp = (date: string) => {
  const UTC8MillisecondOffset = 8 * 60 * 60 * 1000;

  const milliseconds = Date.parse(date);
  const ISODate = new Date(milliseconds + UTC8MillisecondOffset).toISOString();
  const formattedDate = ISODate.replace("T", " ").split(".")[0];
  return formattedDate;
};
