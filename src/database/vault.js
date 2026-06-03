// src/database/vault.js
import * as SecureStore from 'expo-secure-store';
import { NativeModules } from 'react-native';
import { open } from 'react-native-quick-sqlite';
import Aes from 'react-native-aes-crypto';

const db = open({ name: 'prahari.sqlite' });

// Initialize DB
db.execute('CREATE TABLE IF NOT EXISTS Users (id TEXT PRIMARY KEY, enc_embedding TEXT, iv TEXT)');

// 1. Hardware Key Generation (Secure Enclave / Keystore)
const getOrGenerateKey = async () => {
  let key = await SecureStore.getItemAsync('AES_VAULT_KEY');
  if (!key) {
    // Generate a 256-bit key
    key = await Aes.randomKey(32); 
    await SecureStore.setItemAsync('AES_VAULT_KEY', key);
  }
  return key;
};

// 2. Encrypt and Save
export const saveBiometric = async (userId, embeddingArray) => {
  const key = await getOrGenerateKey();
  const iv = await Aes.randomKey(16);
  const plaintext = JSON.stringify(embeddingArray); // The 128-dim vector
  
  const cipher = await Aes.encrypt(plaintext, key, iv, 'aes-256-gcm');
  
  db.execute('INSERT INTO Users (id, enc_embedding, iv) VALUES (?, ?, ?)', [userId, cipher, iv]);
};

// 3. Match in Memory (Never persist raw data)
export const matchBiometric = async (userId, liveEmbeddingArray) => {
  const { rows } = db.execute('SELECT enc_embedding, iv FROM Users WHERE id = ?', [userId]);
  if (rows.length === 0) return false;

  const { enc_embedding, iv } = rows.item(0);
  const key = await getOrGenerateKey();
  
  // Decrypt in memory
  const decryptedStr = await Aes.decrypt(enc_embedding, key, iv, 'aes-256-gcm');
  const storedEmbedding = JSON.parse(decryptedStr);
  
  // Import the cosine similarity from Phase 1
  const score = cosineSimilarity(storedEmbedding, liveEmbeddingArray);
  
  return score > 0.85; // Threshold for MobileFaceNet
};
