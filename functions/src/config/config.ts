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
    client_id: process.env.client_id,
    client_secret: process.env.client_secret,
    jwt_secret_key: process.env.jwt_secret_key,
    gmailEmail: process.env.gmail_email,
    gmailPassword: process.env.gmail_password,
    sendgrid_api_key: process.env.sendgrid_api_key,
};

export default config;
