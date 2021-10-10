require("dotenv").config();

type Config = {
    client_id: string | undefined;
    client_secret: string | undefined;
}

const config: Config = {
    client_id: process.env.client_id,
    client_secret: process.env.client_secret,
};

export default config;
