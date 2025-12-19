const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
require("dotenv").config();
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;
const admin = require('firebase-admin');

// Decode Firebase Service Key
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Middleware
app.use(express.json());
app.use(cors());

//  JWT Middleware 
const verifyJWT = async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ message: 'Unauthorized Access!' });
    }
    const token = authorization.split(' ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
    } catch (err) {
        return res.status(401).send({ message: 'Unauthorized Access!', err });
    }
};

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.6fqewb1.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {


        // start from here
        // -----------------------------------------------------
        const db = client.db("civic-alert-db");
        const issuesCollection = db.collection("issues");
        const usersCollection = db.collection("users");
        const paymentsCollection = db.collection("payments");
        // ---------------------------------------------------------

        const verifyActive = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user?.isBlocked) {
                return res.status(403).send({ message: 'Forbidden: Your account is blocked.' });
            }
            next();
        };

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') return res.status(403).send({ message: 'Forbidden access' });
            next();
        };

        const verifyStaff = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'staff' && user?.role !== 'admin') return res.status(403).send({ message: 'Forbidden access' });
            next();
        };
        // ---------------------------------------------------------
        //payment related apis
        app.post('/create-checkout-session', verifyJWT, verifyActive, async (req, res) => {
            const { price, amount, paymentType, customerEmail, customerName, issueData } = req.body;
            const finalPrice = amount || price || 10;

            let metadata = {
                email: customerEmail,
                name: customerName,
                paymentType: paymentType
            };

            let productName = 'Civic Alert Payment';
            let productDesc = 'Payment Transaction';

            try {
                if (paymentType === 'subscription') {
                    productName = 'Premium Citizen Subscription';
                    productDesc = 'Unlimited reports & Verified Badge';
                } else if (issueData) {
                    let targetIssueId;
                    if (issueData._id) {
                        targetIssueId = issueData._id;
                    } else {
                        const newIssue = {
                            ...issueData,
                            priority: 'Normal',
                            status: 'Pending',
                            paymentStatus: 'Pending',
                            upvotes: 0,
                            upvotedBy: [],
                            createdAt: new Date(),
                            timeline: [{
                                status: "Pending",
                                message: "Drafted for High Priority Promotion",
                                updatedBy: customerName,
                                date: new Date()
                            }]
                        };
                        const savedIssue = await issuesCollection.insertOne(newIssue);
                        targetIssueId = savedIssue.insertedId.toString();
                    }
                    metadata.issueId = targetIssueId;
                    metadata.paymentType = 'issue_promotion';
                    productName = 'High Priority Issue Boost';
                    productDesc = `Promotion for: ${issueData.title}`;
                }

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    customer_email: customerEmail,
                    line_items: [{
                        price_data: {
                            currency: 'bdt',
                            product_data: { name: productName, description: productDesc },
                            unit_amount: parseInt(finalPrice * 100),
                        },
                        quantity: 1,
                    }],
                    mode: 'payment',
                    metadata: metadata,
                    success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}/payment-canceled`,
                });
                res.send({ url: session.url });
            } catch (error) {
                console.error("Stripe Error:", error);
                res.status(500).send({ message: "Failed to create session" });
            }
        });

        app.post('/payment-success', async (req, res) => {
            const { sessionId } = req.body;
            try {
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                const existingOrder = await paymentsCollection.findOne({ transactionId: session.payment_intent });

                if (session.status === 'complete' && !existingOrder) {
                    const paymentRecord = {
                        transactionId: session.payment_intent,
                        email: session.metadata.email,
                        name: session.metadata.name,
                        amount: session.amount_total / 100,
                        date: new Date(),
                        type: session.metadata.paymentType,
                        status: 'paid'
                    };
                    await paymentsCollection.insertOne(paymentRecord);

                    if (session.metadata.paymentType === 'subscription') {
                        await usersCollection.updateOne(
                            { email: session.metadata.email },
                            { $set: { isPremium: true } }
                        );
                    } else if (session.metadata.paymentType === 'issue_promotion') {
                        await issuesCollection.updateOne(
                            { _id: new ObjectId(session.metadata.issueId) },
                            {
                                $set: { priority: 'High', paymentStatus: 'Paid' },
                                $push: {
                                    timeline: {
                                        status: "Promoted",
                                        message: "Upgraded to High Priority 🚀",
                                        updatedBy: "System",
                                        date: new Date()
                                    }
                                }
                            }
                        );
                    }
                    return res.send({ success: true });
                }
                return res.send({ success: true, message: "Already processed" });
            } catch (error) {
                console.error(error);
                res.status(500).send({ success: false });
            }
        });

        app.get('/payments', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await paymentsCollection.find().sort({ date: -1 }).toArray();
            res.send(result);
        });
        //---------------------------------------------------
        //issue related apis

        app.post("/issues", verifyJWT, verifyActive, async (req, res) => {
            const issue = req.body;
            const newIssue = {
                ...issue,
                upvotes: 0,
                upvotedBy: [],
                status: "Pending",
                priority: "Normal",
                createdAt: new Date(),
                timeline: [{
                    status: "Pending",
                    message: "Issue reported by citizen",
                    updatedBy: issue.creatorName || "Citizen",
                    date: new Date()
                }]
            };
            const result = await issuesCollection.insertOne(newIssue);
            res.send(result);
        });

        app.get("/issues", async (req, res) => {
            const { search, status, category } = req.query;
            let query = {};
            if (search) query.title = { $regex: search, $options: 'i' };
            if (status) query.status = status;
            if (category) query.category = category;

            const issues = await issuesCollection.find(query)
                .sort({ priority: 1, createdAt: -1 })
                .toArray();
            res.send(issues);
        });

        app.get("/issues/:id", async (req, res) => {
            const issue = await issuesCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(issue);
        });

        app.get("/my-issues/:email", verifyJWT, async (req, res) => {
            if (req.decoded.email !== req.params.email) return res.status(403).send({ message: 'Forbidden' });
            const result = await issuesCollection.find({ createdBy: req.params.email }).sort({ createdAt: -1 }).toArray();
            res.send(result);
        });

        app.patch("/issues/:id", verifyJWT, verifyActive, async (req, res) => {
            const id = req.params.id;
            const item = req.body;
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    title: item.title,
                    description: item.description,
                    category: item.category,
                    location: item.location,
                    ...(item.image && { image: item.image })
                }
            };
            const result = await issuesCollection.updateOne(filter, updatedDoc);
            res.send(result);
        });


        app.delete("/issues/:id", verifyJWT, verifyActive, async (req, res) => {
            const result = await issuesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });


        app.patch("/issues/upvote/:id", verifyJWT, verifyActive, async (req, res) => {
            const { id } = req.params;
            const { email } = req.body;

            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            if (!issue) return res.status(404).send({ message: "Not found" });
            if (issue.createdBy === email) return res.status(403).send({ message: "Own issue" });
            if (issue.upvotedBy?.includes(email)) return res.status(409).send({ message: "Already upvoted" });

            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                { $inc: { upvotes: 1 }, $push: { upvotedBy: email } }
            );
            res.send(result);
        });

        app.get("/issues/:id/upvote-status", async (req, res) => {
            const { id } = req.params;
            const { email } = req.query;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            const upvoted = issue?.upvotedBy?.includes(email) || false;
            res.send({ upvoted });
        });

        app.patch("/issues/assign/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { staffId, staffName, staffEmail } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    assignedStaff: { staffId, name: staffName, email: staffEmail },
                    status: "Pending"
                },
                $push: {
                    timeline: {
                        status: "Assigned",
                        message: `Assigned to Staff: ${staffName}`,
                        updatedBy: "Admin",
                        date: new Date()
                    }
                }
            };
            const result = await issuesCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.patch("/issues/reject/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const result = await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { status: "Rejected" },
                    $push: {
                        timeline: {
                            status: "Rejected",
                            message: "Issue rejected by Admin",
                            updatedBy: "Admin",
                            date: new Date()
                        }
                    }
                }
            );
            res.send(result);
        });

        //-------------------------------------------------------
        // user related apis

        app.post('/users', async (req, res) => {
            const user = req.body;
            const existingUser = await usersCollection.findOne({ email: user.email });
            if (existingUser) return res.send({ message: 'user exists' });

            const newUser = {
                ...user,
                role: 'citizen',
                isPremium: false,
                isBlocked: false,
                createdAt: new Date(),
            };
            const result = await usersCollection.insertOne(newUser);
            res.send(result);
        });

        // GET all staff
        app.get('/users/staff', verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const result = await usersCollection.find({ role: 'staff' }).toArray();
                res.send(result || []);
            } catch (error) {
                console.error("Error fetching staff:", error);
                res.send([]);
            }
        });

        // create staff
        app.post('/users/staff', verifyJWT, verifyAdmin, async (req, res) => {
            const { email, password, name, photoURL } = req.body;

            try {
                const userRecord = await admin.auth().createUser({
                    email: email,
                    password: password,
                    displayName: name,
                    photoURL: photoURL || "https://i.ibb.co/Zm9J5M4/user-placeholder.png"
                });

                const newStaff = {
                    email: email,
                    name: name,
                    role: 'staff',
                    uid: userRecord.uid,
                    photoURL: photoURL || "https://i.ibb.co/Zm9J5M4/user-placeholder.png",
                    createdAt: new Date()
                };

                const result = await usersCollection.insertOne(newStaff);
                res.send(result);

            } catch (error) {
                console.error("Error creating staff:", error);
                res.status(400).send({ message: error.message });
            }
        });

        app.put('/users/staff/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { name: updatedData.name }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        app.delete('/users/staff/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });

        app.get('/users/:email', verifyJWT, async (req, res) => {
            const result = await usersCollection.findOne({ email: req.params.email });
            res.send(result);
        });

        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.patch('/users/block/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { isBlocked } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { isBlocked: isBlocked } };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });
        //--------------------------------------------------
        //all stats

        app.get('/staff-stats/:email', verifyJWT, verifyStaff, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) return res.status(403).send({ message: 'Forbidden' });

            try {
                const query = { "assignedStaff.email": email };
                const totalAssigned = await issuesCollection.countDocuments(query);
                const resolvedCount = await issuesCollection.countDocuments({ ...query, status: 'Resolved' });
                const pendingCount = await issuesCollection.countDocuments({ ...query, status: 'Pending' });
                const closedCount = await issuesCollection.countDocuments({ ...query, status: 'Closed' });

                res.send({ totalAssigned, resolvedCount, pendingCount, closedCount });
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });

        app.get('/citizen-stats/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) return res.status(403).send({ message: 'Forbidden' });

            try {
                const query = { createdBy: email };

                const totalIssues = await issuesCollection.countDocuments(query);
                const pendingIssues = await issuesCollection.countDocuments({ ...query, status: 'Pending' });
                const inProgressIssues = await issuesCollection.countDocuments({ ...query, status: 'In Progress' });
                const resolvedIssues = await issuesCollection.countDocuments({ ...query, status: 'Resolved' });

                const paymentStats = await paymentsCollection.aggregate([
                    { $match: { email: email } },
                    { $group: { _id: null, totalPaid: { $sum: "$amount" } } }
                ]).toArray();

                const totalPaid = paymentStats.length > 0 ? paymentStats[0].totalPaid : 0;

                res.send({
                    totalIssues,
                    pendingIssues,
                    inProgressIssues,
                    resolvedIssues,
                    totalPaid
                });
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });


        app.get("/assigned-issues/:email", verifyJWT, verifyStaff, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email !== email) return res.status(403).send({ message: 'Forbidden' });

            const query = { "assignedStaff.email": email };
            const result = await issuesCollection.find(query).sort({ status: 1, createdAt: -1 }).toArray();
            res.send(result);
        });

        app.patch("/issues/status/:id", verifyJWT, verifyStaff, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;

            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: status },
                $push: {
                    timeline: {
                        status: status,
                        message: `Status updated to ${status}`,
                        updatedBy: "Staff",
                        date: new Date()
                    }
                }
            };
            const result = await issuesCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('The CivicAlert server is running!');
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
})