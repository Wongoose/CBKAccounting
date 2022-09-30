// import { ReturnValue } from "./helper";
// import { promisify } from "util";
// import nodeRequest = require("request");

// export const put = promisify(nodeRequest.put);
// const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";

// export const generateDummyInvoice = async (firestore: FirebaseFirestore.Firestore, invoice: Record<string, string>): Promise<ReturnValue> => {
//     try {
//         const doc = await firestore.collection("CBKAccounting").doc("tokens").get();
//         const dataMap = doc.data();

//         if (dataMap === undefined) {
//             const result: ReturnValue = {
//             success: false,
//             value: "INTERNAL SERVER ERROR: Cannot read database.",
//             statusCode: 500,
//             };
//             return (result);
//         }

//         const accessToken = dataMap["access_token"];
//         const xeroTenantId = dataMap["xero-tenant-id"];
//         const bankAccountCode = dataMap["bank-account-code"];

//         const requestBody = {
//             Type: "ACCREC",
//             Contact: {
//                 "Name": "DUMMY",
//               },
//             DueDate: "2022-10-01",
//             Status: "AUTHORISED",
//             LineItems: [
//                 {
//                     "Description": invoice.Description,
//                     "UnitAmount": invoice.UnitAmount,
//                     "AccountCode": bankAccountCode,
//                 },
//             ],
//         };

//         const { statusCode, body } = await put({
//             url: XERO_INVOICES_URL,
//             // url: `${XERO_INVOICES_URL}?page=${pageNumber}&order=Date%20${orderDate}`,
//             method: "PUT",
//             headers: {
//               "Content-Type": "application/json",
//               "Authorization": `Bearer ${accessToken}`,
//               "xero-tenant-id": xeroTenantId,
//             },
//             body: JSON.stringify(requestBody),
//           });

//         if (statusCode == 200) {
//             const result: ReturnValue = {
//                 success: true,
//                 value: `Successfully created invoice: ${body}`,
//                 statusCode: 200,
//               };
//             return (result);
//         } else {
//             const result: ReturnValue = {
//                 success: false,
//                 value:
//                   `Failed to generate invoice. ${body}`,
//                 statusCode: 401,
//               };
//               return (result);
//         }

//     } catch (err) {
//         const result: ReturnValue = {
//             success: false,
//             value:
//               `Failed with catch error: ${err}`,
//             statusCode: 401,
//           };
//           return (result);
//     }
// };
