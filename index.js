const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const cors = require('cors')
require("dotenv").config()
const app = express()
const port = process.env.PORT || 3000
// -------------------
app.use(express.json())
app.use(cors())
//--------------

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.6fqewb1.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // --------------- start from here----------------
        //database connection
        const db = client.db('civic-alert-db')
        const issuesCollection = db.collection('issues');


        //-------------------
        //database theke data niye asbo, data manipulate korbo, data add korbo, by api methods

        //GET all events data [find().toArray(), findOne().toArray()] by using GET api methods
        //we can check GET api data by browser directly


        //issues related api 
        app.post('/issues', async (req, res) => {
            const issue = req.body;
            const { title, description, category, priority, image, location, createdBy } = issue;

            // Basic validation
            if (!title || !description || !category || !priority || !location || !createdBy) {
                return res.status(400).send({ message: "Missing required fields" });
            }

            // Create issue document
            const newIssue = {
                title,
                description,
                category,        // must match your categories
                priority,        // High / Normal
                status: "Pending",
                image: image || "",  // optional
                location,
                createdBy,
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Insert into DB
            const result = await issuesCollection.insertOne(newIssue);
            res.send(result);
        });





        //----------------
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

// --------------

app.get('/', (req, res) => {
    res.send('The CivicAlert data base running well!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})