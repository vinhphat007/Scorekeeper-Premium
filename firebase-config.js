/**
 * Firebase project config for "Tiến Lên Scorekeeper".
 * Safe to keep public: this key only identifies the project. Actual write
 * protection is enforced by Firestore Security Rules (see firestore.rules),
 * not by hiding this value.
 */
const firebaseConfig = {
  apiKey: "AIzaSyD1XPwVOH6HyPRFFGWN8yJi44wmSZ8vG6E",
  authDomain: "app-score-keeper.firebaseapp.com",
  projectId: "app-score-keeper",
  storageBucket: "app-score-keeper.firebasestorage.app",
  messagingSenderId: "80454439612",
  appId: "1:80454439612:web:a25e204b256984b68bb6b9"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
