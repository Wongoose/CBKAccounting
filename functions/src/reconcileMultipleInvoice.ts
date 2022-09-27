import { ReturnValue } from "./helper";
import { promisify } from "util";
import nodeRequest = require("request");

export const put = promisify(nodeRequest.put);
const XERO_PAYMENTS_URL = "https://api.xero.com/api.xro/2.0/Payments";

// NEXT - Main cloud function in index.ts
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
      let ip_amount = parseInt(paymentDetails.ip_amount);
      invoiceArray.map((invoice) => totalInvoiceAmount += parseInt(invoice.AmountDue));

      if (parseInt(paymentDetails.ip_amount) != totalInvoiceAmount) {
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

      // Loop through each invoice to reconcile
      let loopFailed = false;
      invoiceArray.forEach(async(invoice) => {
        const requestBody = {
          Invoice: {
            InvoiceNumber: invoice.InvoiceNumber,
            // InvoiceID: invoiceDetails.InvoiceID,
          },
          Account: { Code: bankAccountCode },
          Date: paymentDetails.transaction_date,
          Amount: invoice.AmountDue,
          Reference: `${paymentDetails.email} | ${paymentDetails.remarks}`,
          IsReconciled: true,
        };

        const { statusCode } = await put({
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

        console.log("reconcileMultipleInvoice | statusCode: " + statusCode);
        if (statusCode == 200) {
          ip_amount -= parseInt(invoice.AmountDue);
          await firestore.collection("transactionLogs").doc(trans_doc.id).update({
            listOfReconciledInvoiceID: FirebaseFirestore.FieldValue.arrayUnion([invoice.InvoiceID]),
          });
        } else {
          loopFailed = true;
        }
      });

      // Check again if loop failed && total ip_amount has been matched
      if (!loopFailed && ip_amount == 0)
      {
        // SUCCESS!
        await firestore.collection("transactionLogs").doc(trans_doc.id).update({
          // Only true when match with last invoice in array
          isReconciled: true,
        });

        const result: ReturnValue = {
          success: true,
          value: `iPay88 payment successfully reconciled with ${invoiceArray.length} invoices.`,
          statusCode: 200,
        };
        return (result);
      } else {
        // Revert all actions when failed - NEXT
        const result: ReturnValue = {
          success: false,
          value:
            "Failed to reconcile iPay88 transaction with invoices. Please sync data and try again.",
          statusCode: 401,
        };
        return (result);
      }

    } catch(err) {
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
  }