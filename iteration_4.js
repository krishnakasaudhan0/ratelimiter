import express from 'express'
import { createClient } from 'redis';
import dotenv from 'dotenv'

dotenv.config()

const app = express();
const client = createClient();
app.set("trust proxy", true);

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();



app.get("/",async (req,res) => {

    const {capacity,refil_rate}=req.params;

    const id = req.ip
    
    console.log("IP:", req.ip);
console.log("Forwarded:", req.headers["x-forwarded-for"]);

    const result = await client.eval(`
    local token = redis.call("GET", KEYS[1])
    local last_refill_time =redis.call("GET", KEYS[2])
    
    local time = redis.call("TIME")
    local curr_time = tonumber(time[1]) + tonumber(time[2]) / 1000000


    local capacity = tonumber(ARGV[1])
    local refill_rate = tonumber(ARGV[2])


    if not token then
    token = capacity
    last_refill_time = curr_time
else
    token = tonumber(token)
    last_refill_time = tonumber(last_refill_time)
end

    

    local elapsed = curr_time - last_refill_time

    token = math.min(capacity, token + (elapsed * refill_rate))

    if token >= 1 then
        token = token - 1

        redis.call("SET", KEYS[1], token)
        redis.call("SET", KEYS[2], curr_time)

        return 1
    end

    redis.call("SET", KEYS[1], token)
    redis.call("SET", KEYS[2], curr_time)

    return 0
`, {
    keys: [`ratelimit:${id}:token`, `ratelimit:${id}:last_refill_time` ],
    arguments: [capacity,refil_rate]
});

    if (result) {
        console.log("accept");
        res.status(200).send("accept")
    }else{
        console.log("rejected");
        res.status(429).send("rejected")
    }

   
})

app.listen(process.env.PORT);