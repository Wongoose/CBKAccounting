import { ReturnValue } from "./helper";
import { promisify } from "util";
import nodeRequest = require("request");

export const put = promisify(nodeRequest.put);

export const archiveTransaction = async (
  firestore: FirebaseFirestore.Firestore,
  ip_transid: string,
  ): Promise<ReturnValue> => {
    try {

      const snapshot = await firestore.collection("transactionLogs").where("ip_transid", "==", ip_transid).get();

      snapshot.docs.forEach((doc) => {
        firestore.collection("transactionLogs").doc(doc.id).update({"isArchived": true});
      });

      const result: ReturnValue = {success: true, value: "Successfully archived transaction!"};
      return (result);
    } catch (err) {
      const result: ReturnValue = {
        success: false,
        value: `Failed to archive transaction with firebase error: ${err}`,
        statusCode: 500,
      };
      return (result);
    }
};
