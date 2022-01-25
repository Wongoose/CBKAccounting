import { convertFromFBTimestamp, ReturnValue } from "./helper";

export const getTransactionLogs = async (firestore: FirebaseFirestore.Firestore): Promise<ReturnValue> => {
    try {

        console.log("HELPER.ts: getTransactionLogs Function running...");

        const snapshot = await firestore.collection("transactionLogs").orderBy("log_created", "desc").get();
        // const snapshot = await firestore.collection("transactionLogs").orderBy("log_updated", "desc").get();
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
                dataMap["log_created"] = convertFromFBTimestamp(dataMap["log_created"].toDate());
                dataMap["log_updated"] = convertFromFBTimestamp(dataMap["log_updated"].toDate());

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

            const result: ReturnValue = { success: true, value: JSON.stringify(transactionLogs) };
            return result;
        } else {
            const result: ReturnValue = { success: true, value: "No transaction logs found." };
            return result;

        }

    } catch (error) {
        console.log("HELPTER.ts: getTransactionLogs | FAILED with catch error: " + error);

        const result: ReturnValue = { success: false, value: "Failed with catch error." };
        return result;

    }
};
