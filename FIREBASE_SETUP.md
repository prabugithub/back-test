# Firebase Setup for Frontend State Persistence

To enable saving and resuming sessions (trades, playback pos, etc.), you need to connect your frontend to Firebase.

## 1. Create a Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **"Add project"** and follow the steps.
3. Disable Google Analytics (optional, for simplicity).

## 2. Enable Firestore Database
1. In your Firebase project dashboard, go to **Build** -> **Firestore Database**.
2. Click **Create Database**.
3. Choose a location (e.g., `asia-south1` or `us-central`).
4. **Security Rules**: Start in **Test mode** (allows read/write for 30 days) OR use the following rules for development:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /sessions/{sessionId} {
         allow read, write: if true; // Open access for your personal tool
       }
     }
   }
   ```

## 3. Register Web App
1. Go to **Project Settings** (gear icon).
2. Under "Your apps", click the web icon (`</>`).
3. Give it a nickname (e.g., "Backtest Frontend").
4. Copy the `firebaseConfig` object provided.

## 4. Configure Your Application
1. Create a `.env` file in the `frontend` directory (if it doesn't exist).
2. Add your Firebase keys as follows (replace values with yours):

```env
VITE_FIREBASE_API_KEY=your_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## 5. Deployment
- Since this uses Firestore directly from the frontend, you can deploy your frontend to **GitHub Pages** or **Firebase Hosting**.
- **GitHub Pages**: Run `npm run deploy` in the `frontend` folder.
- **Firebase Hosting**: Run `firebase init hosting` and follow instructions.

## Notes
- Currently, the system supports a single "Restore" slot (`current_session`).
- The backend API (Angel One / Yahoo) is still running locally to fetch candle data. This "Hybrid" mode allows you to save your progress in the cloud while keeping heavy data fetching local.
