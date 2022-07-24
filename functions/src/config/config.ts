require("dotenv").config();

type Config = {
    client_id: string | undefined;
    client_secret: string | undefined;
    jwt_secret_key: string | undefined;
    gmailEmail: string | undefined;
    gmailPassword: string | undefined;
    sendgrid_api_key: string | undefined;
}

const config: Config = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    jwt_secret_key: process.env.JWT_SECRET_KEY,
    gmailEmail: process.env.GMAIL_EMAIL,
    gmailPassword: process.env.GMAIL_PASSWORD,
    sendgrid_api_key: process.env.SENDGRID_API_KEY,
};

export default config;
