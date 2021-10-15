require("dotenv").config();

type Config = {
    client_id: string | undefined;
    client_secret: string | undefined;
    jwt_secret_key: string | undefined;
}

const config: Config = {
    client_id: process.env.client_id,
    client_secret: process.env.client_secret,
    jwt_secret_key: process.env.jwt_secret_key,

};

export default config;
