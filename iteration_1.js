const express = require('express')
const {Mutex} = require('async-mutex')
const app = express();

var token = 100;

const mutex =new Mutex()
function refil_token() {
    setInterval(() => {
        if (token < 100) {
            token++
        }

    }, 1000)
}
refil_token();

app.get("/", async (req, res) => {
    let isAccepted = false;
    let currentTokenCount = 0;

  
    await mutex.runExclusive(() => {
        if (token > 0) {
            token--;
            isAccepted = true;
            currentTokenCount = token;
        }
    });

    
    if (isAccepted) {
        console.log("accepted", currentTokenCount);
        res.status(200).send("request accept");
    } else {
        console.log("rejected");
        res.status(429).send("limit exceed");
    }
});
app.get("/without_mutex",(req,res)=>{
    if (token > 0) {
            token--;
            console.log("accepted", token);
        res.status(200).send("request accept");
            
        }
        else {
        console.log("rejected");
        res.status(429).send("limit exceed");
    }

})

app.listen(3000)