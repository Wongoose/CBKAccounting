import { convertFromFBTimestamp, ReturnValue } from "./helper";
import { promisify } from "util";
import nodeRequest = require("request");

export const get = promisify(nodeRequest.get);
export const put = promisify(nodeRequest.put);

const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const XERO_PAYMENTS_URL = "https://api.xero.com/api.xro/2.0/Payments";

export const getTransactionLogs = async (
  firestore: FirebaseFirestore.Firestore,
  showReconciled: boolean
): Promise<ReturnValue> => {
  try {
    console.log("HELPER.ts: getTransactionLogs Function running...");

    let snapshot;
    if (showReconciled) {
      snapshot = await firestore
        .collection("transactionLogs")
        .orderBy("log_created", "desc")
        .get();
    } else {
      // FALSE
      snapshot = await firestore
        .collection("transactionLogs")
        .where("isReconciled", "==", showReconciled)
        .orderBy("log_created", "desc")
        .get();
    }
    const transactionLogs: any[] = [];

    if (snapshot.docs.length != 0) {
      // has transactionLogs
      snapshot.forEach((doc) => {
        const dataMap = doc.data();
        let finalStatus = "";

        if (dataMap === undefined) {
          console.log("HELPER.ts: getTransactionLogs | Failed");
          // const result: ReturnValue = { success: false, value: "Failed to read data from database", statusCode: 500 };
          throw Error("Failed to read data from database");
        }

        // console.log("HELPTER.ts: getTransactionLogs | dataMap log created date is: " + convertFromFBTimestamp(dataMap["log_created"].toDate()));
        dataMap["log_created"] = convertFromFBTimestamp(
          dataMap["log_created"].toDate()
        );
        dataMap["log_updated"] = convertFromFBTimestamp(
          dataMap["log_updated"].toDate()
        );

        if ((dataMap["log_error"] as string).length == 0) {
          // no log error
          if (dataMap["isReconciled"]) {
            finalStatus = "Reconciled";
          } else {
            finalStatus = "Not reconciled";
          }
        } else {
          // has log error
          finalStatus = "Error";
        }

        dataMap["final_status"] = finalStatus;
        transactionLogs.push(dataMap);
      });

      const result: ReturnValue = {
        success: true,
        value: JSON.stringify(transactionLogs),
      };
      return result;
    } else {
      const result: ReturnValue = {
        success: true,
        value: "No transaction logs found.",
      };
      return result;
    }
  } catch (error) {
    console.log(
      "HELPTER.ts: getTransactionLogs | FAILED with catch error: " + error
    );

    const result: ReturnValue = {
      success: false,
      value: "Failed with catch error.",
    };
    return result;
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
    formatUrl.searchParams.append("where", "Status==\"AUTHORISED\"");
    formatUrl.searchParams.append("summaryOnly", "True");

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

export const xeroReconcilePayment = async (
  firestore: FirebaseFirestore.Firestore,
  invoiceDetails: Record<string, string>,
  paymentDetails: Record<string, string>
): Promise<ReturnValue> => {
  try {
    console.log("\nSTART OF xeroReconcilePayment:\n");

    const transactionSnap = await firestore
      .collection("transactionLogs")
      .where("ip_transid", "==", paymentDetails.ip_transid)
      .get();

    const transactionFBData = transactionSnap.docs[0].data();
    const transactionIsReconciled = transactionFBData["isReconciled"];

    if (transactionIsReconciled != false) {
      // Not allowed to perform action because already RECONCILED
      const result: ReturnValue = {
        success: false,
        value:
          "Cannot perform action. This payment has already been reconciled with another invoice.",
        statusCode: 400,
      };
      return result;
    }

    console.log(`Transaction reconciled: ${transactionIsReconciled}`);

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
    const bankAccountCode = dataMap["bank-account-code"];

    const requestBody = {
      Invoice: {
        InvoiceNumber: invoiceDetails.InvoiceNumber,
        // InvoiceID: invoiceDetails.InvoiceID,
      },
      Account: { Code: bankAccountCode },
      Date: paymentDetails.transaction_date,
      Amount: paymentDetails.ip_amount,
      Reference: `${paymentDetails.email} | ${paymentDetails.remarks}`,
      IsReconciled: true,
    };

    const { statusCode, body } = await put({
      url: XERO_PAYMENTS_URL,
      // url: `${XERO_INVOICES_URL}?page=${pageNumber}&order=Date%20${orderDate}`,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "xero-tenant-id": xeroTenantId,
      },
      body: JSON.stringify(requestBody),
    });

    console.log("xeroReconcilePayment | statusCode: " + statusCode);
    console.log("xeroReconcilePayment | body: " + body);

    switch (statusCode) {
    case 200: {
      // Success
      const snapshot = await firestore
      .collection("transactionLogs")
      .where("ip_transid", "==", paymentDetails.ip_transid)
      .get();

    const doc = snapshot.docs[0];

    await firestore.collection("transactionLogs").doc(doc.id).update({
      isReconciled: true,
      reconciledInvoiceID: invoiceDetails.InvoiceID,
    });

    const result: ReturnValue = {
      success: true,
      value: `iPay88 payment successfully reconciled with ${invoiceDetails.InvoiceNumber}.`,

      statusCode,
    };
    return result;

    }
    case 400: {
      // ValidationErrors
      const result: ReturnValue = {
        success: false,
        value: `Failed to reconcile iPay88 transaction. ${JSON.parse(body).Elements[0]?.ValidationErrors[0]?.Message}`,
        error: JSON.parse(body).Elements[0]?.ValidationErrors[0]?.Message,
        // error: body.ValidationErrors[0].Message,
        statusCode: 400,
      };
      return result;

    }
    case 401: {
      // Unauthorized
      const result: ReturnValue = {
        success: false,
        value:
          "Failed to reconcile iPay88 transaction. Please sync data and try again.",
        error: body,
        statusCode: 401,
      };
      return result;
    }
    default: {
      const result: ReturnValue = {
        success: false,
        value:
          "An internal error has occured. No actions were made to Xero. Please try again or contact your developer.",
        error: body,
        statusCode: 500,
      };
      return result;
    }
}


  } catch (err) {
    console.log(`xeroReconcilePayment | FAILED with catch error: ${err}`);
    const result: ReturnValue = {
      success: false,
      value:
        "An internal error has occured. No actions were made to Xero. Please try again or contact your developer.",
      error: JSON.stringify(err),
      statusCode: 500,
    };
    return result;
  }
};
