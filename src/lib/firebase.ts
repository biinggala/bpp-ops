import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            'AIzaSyAEHtyd871jl00_ZgmM-W5ht1GZ_LjC8xg',
  authDomain:        'cringe-friends-1df62.firebaseapp.com',
  databaseURL:       'https://cringe-friends-1df62-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId:         'cringe-friends-1df62',
  storageBucket:     'cringe-friends-1df62.firebasestorage.app',
  messagingSenderId: '930969419587',
  appId:             '1:930969419587:web:c4b60dc42c2df13af9f9f6',
}

const app = initializeApp(firebaseConfig)

export const db   = getDatabase(app)
export const auth = getAuth(app)
