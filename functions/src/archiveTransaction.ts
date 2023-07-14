import { ReturnValue } from "./helper";
import { promisify } from "util";
import nodeRequest = require("request");

export const put = promisify(nodeRequest.put);

export const archiveTransaction = async (
  firestore: FirebaseFirestore.Firestore,
  ip_transid: string,
  ): Promise<ReturnValue> => {
    try {

      await firestore.collection("transactionLogs").doc(ip_transid).update({"isArchive": true});

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
