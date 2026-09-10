import express from "express";
import { rateLimiter } from "./ratelimiter.js";
import dotenv from 'dotenv';
dotenv.config();

const app = express();



app.set("trust proxy", true);

const limiter = rateLimiter(100, 1);

app.get("/", limiter, (req, res) => {
    res.send("Home");
});

app.get("/users", limiter, (req, res) => {
    res.send("Users");
});

app.get("/products", limiter, (req, res) => {
    res.send("Products");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});