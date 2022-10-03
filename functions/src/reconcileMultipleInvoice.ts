import { ReturnValue } from "./helper";
import { promisify } from "util";
import nodeRequest = require("request");
import admin = require("firebase-admin");

export const put = promisify(nodeRequest.put);
const XERO_PAYMENTS_URL = "https://api.xero.com/api.xro/2.0/Payments";

type RequestBody = {
  Invoice: {
      InvoiceNumber: string;
  };
  Account: {
      Code: any;
  };
  Date: string;
  Amount: string;
  Reference: string;
  IsReconciled: boolean;
}

// NEXT - Error revert everything
export const reconcileMultipleInvoice = async (
    firestore: FirebaseFirestore.Firestore,
    invoiceArray: Array<Record<string, string>>,
    paymentDetails: Record<string, string>
  ): Promise<ReturnValue> => {
    try {
      console.log("\nSTART OF reconcileMultipleInvoice:\n");

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
        return (result);
      }

      const accessToken = dataMap["access_token"];
      const xeroTenantId = dataMap["xero-tenant-id"];
      const bankAccountCode = dataMap["bank-account-code"];

      let totalInvoiceAmount = 0;
      const ip_amount = Number(paymentDetails.ip_amount);
      invoiceArray.map((invoice) => totalInvoiceAmount += Number(invoice.AmountDue));

      if (ip_amount != totalInvoiceAmount) {
        console.log("BAD REQUEST: Payment amount does not match the total invoice amount");
        const result: ReturnValue = {
          success: false,
          value: "BAD REQUEST: Payment amount does not match the total invoice amount",
          statusCode: 400,
        };
        return (result);
      }

      // After confirm Payment Amount == total Invoice AmountDue
      // Get Firebase transaction document first
      const snapshot = await firestore
      .collection("transactionLogs")
      .where("ip_transid", "==", paymentDetails.ip_transid)
      .get();

      const trans_doc = snapshot.docs[0];

      // Loop through each invoice add to paymentList for batch API
      let paymentList: Array<RequestBody> = [];

      for (let i = 0; i < invoiceArray.length; i++) {

        const requestBody: RequestBody = {
          Invoice: {
            InvoiceNumber: invoiceArray[i].InvoiceNumber,
            // InvoiceID: invoiceDetails.InvoiceID,
          },
          Account: { Code: bankAccountCode },
          Date: paymentDetails.transaction_date,
          Amount: invoiceArray[i].AmountDue,
          Reference: `${paymentDetails.email} | ${paymentDetails.remarks}`,
          IsReconciled: true,
        };

        paymentList = paymentList.concat(requestBody);
      }

      // Batch request to Xero
      const { statusCode, body } = await put({
        url: XERO_PAYMENTS_URL,
        // url: `${XERO_INVOICES_URL}?page=${pageNumber}&order=Date%20${orderDate}`,
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${accessToken}`,
          "xero-tenant-id": xeroTenantId,
        },
        body: JSON.stringify({"Payments": paymentList}),
      });

      console.log("reconcileMultipleInvoice | statusCode: " + statusCode);
      if (statusCode == 200) {
        // SUCCESS Batch request
        for (let i = 0; i < invoiceArray.length; i++) {
            await firestore.collection("transactionLogs").doc(trans_doc.id).update({
              // change name to ...reconciledInvoiceNumbers
              listOfReconciledInvoiceIDs: admin.firestore.FieldValue.arrayUnion(invoiceArray[i].InvoiceNumber),
            });
        }

        // Update FB transaction reconciled to TRUE
        await firestore.collection("transactionLogs").doc(trans_doc.id).update({
          isReconciled: true,
        });

        const result: ReturnValue = {
          success: true,
          value: `iPay88 payment successfully reconciled with ${invoiceArray.length} invoices. Total invoice amount is RM${totalInvoiceAmount}. iPay88 amount is RM${paymentDetails.ip_amount}`,
          statusCode: 200,
        };
        return (result);

      } else {
        console.log(`reconcileMultipleInvoice | ERROR making batch payments: ${body}`);
        // Revert all actions when failed - NEXT
        const result: ReturnValue = {
          success: false,
          value:
            "Failed to reconcile iPay88 transaction with invoices. Please sync data and try again.",
          statusCode: 401,
        };
        return (result);
      }

    } catch (err) {
      console.log(`reconcileMultipleInvoice | FAILED with catch error: ${err}`);
      const result: ReturnValue = {
        success: false,
        value:
          "An internal error has occured. No actions were made to Xero. Please try again or contact your developer.",
        error: JSON.stringify(err),
        statusCode: 500,
      };
      return (result);
    }
  };
