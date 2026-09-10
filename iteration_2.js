import express from 'express'
import { createClient } from 'redis';


const app = express();
const client = createClient();

client.on('error', err => console.log('Redis Client Error', err));

await client.connect();

await client.set("token",100)

const [second] = await client.time()

await client.set("last_refill_time",second)





app.get("/",async (req,res) => {

    let token =await client.get("token")
   
    token =parseInt(token ,10)
  
   

    let [curr_time]=await client.time()
    curr_time =parseInt(curr_time,10)
     
   
    let last_refill_time=await client.get('last_refill_time')
    last_refill_time=parseInt(last_refill_time,10)
    token += curr_time-last_refill_time


    if(token > 100){
        token =100
        await client.set('token',100)
    }else{
        await client.set('token',token)
    }

    if(token>0){
        const new_token = await client.set('token', --token);
        const new_last_time = await client.set('last_refill_time',curr_time)
        console.log("accepted",token)
        res.status(200).send("accepted")
    }
    else{
            console.log("rejected",token)
            res.status(429).send("rejected");
    }

    

})

app.listen(3000);