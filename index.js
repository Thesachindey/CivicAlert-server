const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const cors = require('cors')
require("dotenv").config()
const app = express()
const port = process.env.PORT || 3000
const admin = require('firebase-admin');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
    'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
})
// ----------

// -------------------
app.use(express.json())
app.use(cors())
//--------------

// jwt middlewares
const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]
    console.log(token)
    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        console.log(decoded)
        next()
    } catch (err) {
        console.log(err)
        return res.status(401).send({ message: 'Unauthorized Access!', err })
    }
}




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
        // import { ObjectId } from "mongodb";

        // Database
        const db = client.db("civic-alert-db");
        const issuesCollection = db.collection("issues");

        // -----------------------------------------------------------
        // ISSUES related APIs

        //create new issue
        app.post("/issues", async (req, res) => {
            const issue = req.body;

            const newIssue = {
                ...issue,
                upvotes: 0,
                upvotedBy: [],
                status: "Pending",
                createdAt: new Date(),
            };

            try {
                const result = await issuesCollection.insertOne(newIssue);
                res.send(result);
            } catch {
                res.status(500).send({ message: "Failed to create issue" });
            }
        });

        // GET all issue
        app.get("/issues", async (req, res) => {
            try {
                const issues = await issuesCollection.find().sort({ upvotes: -1, createdAt: -1 }).toArray();
                res.send(issues);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch issues" });
            }
        });

        // GET single issue by id
        app.get("/issues/:id", async (req, res) => {
            const { id } = req.params;
            try {
                const issue = await issuesCollection.findOne({ _id: new ObjectId(id), });
                res.send(issue);
            } catch {
                res.status(400).send({ message: "Invalid issue id" });
            }
        });

        // check upvote status
        app.get("/issues/:id/upvote-status", async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;

            try {
                const issue = await issuesCollection.findOne(
                    { _id: new ObjectId(id) },
                    { projection: { upvotedBy: 1 } }
                );

                const upvoted = issue?.upvotedBy?.includes(email);
                res.send({ upvoted });
            } catch {
                res.status(400).send({ upvoted: false });
            }
        });

        // UpVote issue
        app.patch("/issues/upvote/:id", async (req, res) => {
            const { id } = req.params;
            const { email } = req.body;

            try {
                const issue = await issuesCollection.findOne({
                    _id: new ObjectId(id),
                });

                if (!issue) {
                    return res.status(404).send({ message: "Issue not found" });
                }

                if (issue.createdBy === email) {
                    return res.status(403).send({ message: "Cannot upvote own issue" });
                }

                if (issue.upvotedBy.includes(email)) {
                    return res.status(409).send({ message: "Already upvoted" });
                }

                const result = await issuesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $inc: { upvotes: 1 },
                        $push: { upvotedBy: email },
                    }
                );

                res.send(result);
            } catch {
                res.status(500).send({ message: "Upvote failed" });
            }
        });

        //-------------------------------------------------------------



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