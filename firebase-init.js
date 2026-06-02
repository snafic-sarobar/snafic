const firebaseConfig = {
  apiKey: "AIzaSyBx98pbx1jI8DIiOZy1A-XcTRCQZuM5hSw",
  authDomain: "snafic.firebaseapp.com",
  databaseURL: "https://snafic-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "snafic",
  storageBucket: "snafic.firebasestorage.app",
  messagingSenderId: "694684038399",
  appId: "1:694684038399:web:524875451091fa5e8648ca",
  measurementId: "G-YNZTBZ72HG"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
auth.onAuthStateChanged(u => { currentUser = u; });
