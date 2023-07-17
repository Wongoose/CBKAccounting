import admin = require("firebase-admin");
import { ReturnValue } from "./helper";
import nodemailer = require("nodemailer");
import { promisify } from "util";

// NOT USED
export const signInEmailWithLink = async (email: string, redirectUrl: string, auth: admin.auth.Auth): Promise<ReturnValue> => {
    try {
        if (!email) {
            const result: ReturnValue = { success: false, value: "FAILED: No administrator email found in query parameters." };
            return result;
        }

        const resultGetUser = await auth.getUserByEmail(email).catch(function () {
            console.log("Firebase Auth | Cannot find user by email");
            return null;
        });

        if (resultGetUser === null) {
            const result: ReturnValue = { success: false, value: email + " is an unauthorized email." };
            return result;
        } else {
            console.log("xeroManualAuth | Authorized email address");
            const actionCodeSettings: admin.auth.ActionCodeSettings = {
                url: redirectUrl,
            };

            const signInWithEmailLink = await auth.generateSignInWithEmailLink(email, actionCodeSettings);

            const transporter = nodemailer.createTransport();

            const mailOptions = {
                from: "no-reply-cbkaccounting@gmail.com",
                to: email,
                subject: "Sending Email using Node.js",
                text: signInWithEmailLink,
            };

            let resultSendMail: ReturnValue;

            const sendMail = promisify(transporter.sendMail);
            try {
                await sendMail(mailOptions);
                resultSendMail = { success: true, value: "A sign in email has been sent to " + email + ". Please check your inbox and follow the link to proceed with authorization." };
                return resultSendMail;

            } catch (error) {
                resultSendMail = { success: false, value: "Failed to send email to " + email, statusCode: 500 };
                return resultSendMail;

            }

            // if (error) {
            //     console.log(error);
            //     resultSendMail = { success: false, value: "Failed to send email to " + email, statusCode: 500 };
            // } else {
            //     console.log("Email sent: " + info.response);
            //     resultSendMail = { success: true, value: "A sign in email has been sent to " + email + ". Please check your inbox and follow the link to proceed with authorization." };

            // }

        }
    } catch (error) {
        const result: ReturnValue = { success: false, value: "INTERNAL SERVER ERROR: " + error, statusCode: 500 };
        return result;

    }
};
