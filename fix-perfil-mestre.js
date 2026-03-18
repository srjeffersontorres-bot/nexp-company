// fix-perfil-mestre.js
// Roda UMA VEZ para salvar o perfil do mestre no Firestore
// usando o UID do usuário já existente no Firebase Auth.

const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const { getFirestore, doc, setDoc } = require("firebase/firestore");

const firebaseConfig = {
  apiKey: "AIzaSyAnYyVIb5AxUd1qkQuXVEpEw7COzW2nvDw",
  authDomain: "nexpcompany-9a7ba.firebaseapp.com",
  projectId: "nexpcompany-9a7ba",
  storageBucket: "nexpcompany-9a7ba.firebasestorage.app",
  messagingSenderId: "1043432853586",
  appId: "1:1043432853586:web:10d443d6757420fe01cf8b",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const MESTRE_EMAIL = "nexpcred@gmail.com";
const MESTRE_SENHA = "MestredaNexp2027@";

async function fix() {
  try {
    console.log("Fazendo login para obter o UID...");
    const cred = await signInWithEmailAndPassword(auth, MESTRE_EMAIL, MESTRE_SENHA);
    const uid = cred.user.uid;
    console.log("✅ UID obtido:", uid);

    console.log("Salvando perfil no Firestore...");
    await setDoc(doc(db, "users", uid), {
      id: uid,
      uid: uid,
      username: "NexpCompanyADM",
      email: MESTRE_EMAIL,
      role: "mestre",
      name: "Mestre Nexp",
      cpf: "",
      photo: null,
      active: true,
      createdBy: null,
    });

    console.log("✅ Perfil salvo com sucesso!");
    console.log("─────────────────────────────────────────────");
    console.log("E-mail:  " + MESTRE_EMAIL);
    console.log("Senha:   " + MESTRE_SENHA);
    console.log("─────────────────────────────────────────────");
    process.exit(0);
  } catch (e) {
    console.error("❌ Erro:", e.message);
    console.log("\nVerifique se a senha está correta e tente novamente.");
    process.exit(1);
  }
}

fix();
