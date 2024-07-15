const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { MongoClient, ServerApiVersion } = require('mongodb');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();
const PORT = 3000;

const uploadDir = path.join(__dirname, 'uploads');
const profilePicturesDir = path.join(__dirname, 'profile-pictures');

// Ensure the upload directories exist
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`Created directory: ${uploadDir}`);
}
if (!fs.existsSync(profilePicturesDir)) {
    fs.mkdirSync(profilePicturesDir, { recursive: true });
    console.log(`Created directory: ${profilePicturesDir}`);
}

// Multer storage configuration with randomized filenames
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dest = req.path.includes('profile') ? profilePicturesDir : uploadDir;
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        const uniqueName = crypto.randomBytes(16).toString('hex') + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

// Multer filter configuration to restrict file types
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/gif', 'image/png', 'image/jpeg', 'image/webp',
        'audio/mpeg', 'audio/wav', 'video/mp4'
    ];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// MongoDB setup
const uri = "mongodb+srv://sflyonlee:UiG1lo0Ng1tr8cB0@cluster0.c0ou53c.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    store: MongoStore.create({ mongoUrl: uri })
}));

const planStorageLimits = {
    'Basic': 215 * 1024 * 1024,
    'Standard': 1 * 1024 * 1024 * 1024,
    'Premium': 10 * 1024 * 1024 * 1024,
    'Ultimate': 50 * 1024 * 1024 * 1024
};

async function run() {
    try {
        // Connect the client to the server
        await client.connect();
        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        const db = client.db('moonapp');
        const usersCollection = db.collection('users');
        const filesCollection = db.collection('files');
        const profilesCollection = db.collection('profiles');

        // Middleware to check if user is logged in
        const isAuthenticated = (req, res, next) => {
            if (req.session.username) {
                next();
            } else {
                res.status(403).send('User not logged in');
            }
        };

        // Serve the main pages
        app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'index.html'));
        });

        app.get('/dashboard', isAuthenticated, (req, res) => {
            res.sendFile(path.join(__dirname, 'dashboard.html'));
        });

        app.get('/plans', (req, res) => {
            res.sendFile(path.join(__dirname, 'plans.html'));
        });

        app.get('/settings', isAuthenticated, (req, res) => {
            res.sendFile(path.join(__dirname, 'settings.html'));
        });

        // Signup route
        app.post('/signup', async (req, res) => {
            console.log('Received signup request');
            const { username, password } = req.body;

            if (!username || !password) {
                console.log('Username or password missing');
                return res.status(400).send('Username and password are required');
            }

            const existingUser = await usersCollection.findOne({ username });
            if (existingUser) {
                console.log('Username already exists');
                return res.status(400).send('Username already exists');
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            await usersCollection.insertOne({ username, password: hashedPassword, plan: 'Basic', storageLimit: planStorageLimits['Basic'] });
            req.session.username = username;
            res.status(200).send('User registered successfully');
        });

        // Login route
        app.post('/login', async (req, res) => {
            console.log('Received login request');
            const { username, password } = req.body;

            const user = await usersCollection.findOne({ username });
            if (!user) {
                console.log('Invalid username');
                return res.status(400).send('Invalid username or password');
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                console.log('Invalid password');
                return res.status(400).send('Invalid username or password');
            }

            req.session.username = username;
            res.status(200).send('Login successful');
        });

        // Check if logged in
        app.get('/isLoggedIn', (req, res) => {
            if (req.session.username) {
                res.status(200).json({ username: req.session.username });
            } else {
                res.status(403).send('User not logged in');
            }
        });

        // Get user plan
        app.get('/getUserPlan', isAuthenticated, async (req, res) => {
            const username = req.session.username;
            const user = await usersCollection.findOne({ username });

            res.json(user.plan);
        });

        // Choose plan
        app.post('/choosePlan', isAuthenticated, async (req, res) => {
            const username = req.session.username;
            const { plan } = req.body;

            if (!planStorageLimits[plan]) {
                return res.status(400).send('Invalid plan');
            }

            try {
                await usersCollection.updateOne(
                    { username },
                    { $set: { plan, storageLimit: planStorageLimits[plan] } }
                );
                res.status(200).send('Plan updated successfully');
            } catch (error) {
                console.error('Error updating plan:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Logout route
        app.post('/logout', (req, res) => {
            req.session.destroy();
            res.status(200).send('Logout successful');
        });

        // Upload file route
        app.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
            console.log('Received file upload request');
            if (!req.file) {
                console.error('No file uploaded');
                return res.status(400).send('No file uploaded');
            }

            const username = req.session.username;
            const user = await usersCollection.findOne({ username });
            const userFiles = await filesCollection.find({ username }).toArray();
            const totalSize = userFiles.reduce((sum, file) => sum + file.size, 0);

            if (totalSize + req.file.size > user.storageLimit) {
                console.error('Exceeds storage limit');
                return res.status(400).send('Uploading this file will exceed your storage limit.');
            }

            const fileData = {
                username,
                filename: req.file.filename,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size,
                path: req.file.path,
                uploadDate: new Date()
            };

            try {
                await filesCollection.insertOne(fileData);
                res.status(200).send({ filename: req.file.filename });
            } catch (error) {
                console.error('Error inserting file data into MongoDB:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Get files route
        app.get('/files', isAuthenticated, async (req, res) => {
            const username = req.session.username;
            console.log('Received request to list files for user:', username);

            try {
                const files = await filesCollection.find({ username }).toArray();
                res.status(200).send(files);
            } catch (error) {
                console.error('Error fetching files from MongoDB:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Delete file route
        app.delete('/delete/:filename', isAuthenticated, async (req, res) => {
            const filename = req.params.filename;
            const username = req.session.username;

            try {
                const file = await filesCollection.findOne({ filename, username });
                if (!file) {
                    return res.status(404).send('File not found');
                }

                await filesCollection.deleteOne({ filename, username });
                fs.unlinkSync(path.join(uploadDir, filename));
                res.status(200).send('File deleted successfully');
            } catch (error) {
                console.error('Error deleting file from MongoDB:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Create and update profile route
        app.post('/createProfile', isAuthenticated, upload.fields([
            { name: 'profilePicture', maxCount: 1 },
            { name: 'music', maxCount: 1 }
        ]), async (req, res) => {
            const username = req.session.username;
            const { description, pronouns, about, discord, x, instagram, facebook, youtube, guilded } = req.body;

            const profileData = {
                username,
                description,
                pronouns,
                about,
                discord,
                x,
                instagram,
                facebook,
                youtube,
                guilded,
                profilePicture: req.files.profilePicture ? req.files.profilePicture[0].filename : null,
                music: req.files.music ? req.files.music[0].filename : null
            };

            try {
                await profilesCollection.updateOne(
                    { username },
                    { $set: profileData },
                    { upsert: true }
                );

                // Generate a static profile page for the user
                const profilePagePath = path.join(__dirname, 'profiles', `${username}.html`);
                const profilePageContent = generateProfilePage(profileData);
                fs.writeFileSync(profilePagePath, profilePageContent);

                res.status(200).json({ message: 'Profile created successfully', profileUrl: `/profiles/${username}.html` });
            } catch (error) {
                console.error('Error creating profile:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Get profile route
        app.get('/profile', isAuthenticated, async (req, res) => {
            const username = req.session.username;
            try {
                const profile = await profilesCollection.findOne({ username });
                if (profile) {
                    res.json(profile);
                } else {
                    res.status(404).send('Profile not found');
                }
            } catch (error) {
                console.error('Error fetching profile:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Get public profile route
        app.get('/profile/:username', async (req, res) => {
            const { username } = req.params;
            try {
                const profile = await profilesCollection.findOne({ username });
                if (profile) {
                    res.json(profile);
                } else {
                    res.status(404).send('Profile not found');
                }
            } catch (error) {
                console.error('Error fetching profile:', error);
                res.status(500).send('Internal Server Error');
            }
        });

        // Submit payment route
        app.post('/submitPayment', isAuthenticated, async (req, res) => {
            const { name, lastName, cardNumber, expiryDate, cvv } = req.body;

            // Here, you would normally process the payment using a payment gateway

            res.status(200).send('Payment processed successfully');
        });

        // Start the server after connecting to the database
        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to connect to MongoDB Atlas:', err);
    }
}

function generateProfilePage(profileData) {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${profileData.username}'s Profile</title>
            <style>
                body {
                    font-family: 'Roboto', sans-serif;
                    margin: 0;
                    padding: 0;
                    background-color: #121212;
                    color: #e0e0e0;
                }

                .container {
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 2rem;
                    background: #1e1e1e;
                    border-radius: 10px;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
                }

                .profile-section {
                    margin-bottom: 1.5rem;
                }

                .profile-section h2 {
                    margin-bottom: 0.5rem;
                }

                .profile-section img {
                    max-width: 100%;
                    border-radius: 10px;
                }

                .profile-section audio {
                    width: 100%;
                    margin-top: 0.5rem;
                }

                .links a {
                    display: block;
                    color: #bb86fc;
                    margin-bottom: 0.5rem;
                    text-decoration: none;
                }

                .links a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>${profileData.username}'s Profile</h1>
                <div class="profile-section">
                    <h2>Username</h2>
                    <p>${profileData.username}</p>
                </div>
                <div class="profile-section">
                    <h2>Profile Picture</h2>
                    <img src="/profile-pictures/${profileData.profilePicture}" alt="Profile Picture">
                </div>
                <div class="profile-section">
                    <h2>Music</h2>
                    <audio controls>
                        <source src="/uploads/${profileData.music}" type="audio/mp3">
                        Your browser does not support the audio element.
                    </audio>
                </div>
                <div class="profile-section">
                    <h2>Description</h2>
                    <p>${profileData.description}</p>
                </div>
                <div class="profile-section">
                    <h2>Pronouns</h2>
                    <p>${profileData.pronouns}</p>
                </div>
                <div class="profile-section">
                    <h2>About</h2>
                    <p>${profileData.about}</p>
                </div>
                <div class="profile-section links">
                    <h2>Links</h2>
                    ${profileData.discord ? `<a href="${profileData.discord}">Discord</a>` : ''}
                    ${profileData.x ? `<a href="${profileData.x}">X</a>` : ''}
                    ${profileData.instagram ? `<a href="${profileData.instagram}">Instagram</a>` : ''}
                    ${profileData.facebook ? `<a href="${profileData.facebook}">Facebook</a>` : ''}
                    ${profileData.youtube ? `<a href="${profileData.youtube}">YouTube</a>` : ''}
                    ${profileData.guilded ? `<a href="${profileData.guilded}">Guilded</a>` : ''}
                </div>
            </div>
        </body>
        </html>
    `;
}

run().catch(console.dir);
