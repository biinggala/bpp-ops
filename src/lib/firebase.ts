import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            'AIzaSyA7oKvx17RJ-EV1o8qnl7UhkM87MaVj_gA',
  authDomain:        'crng-task-manager.firebaseapp.com',
  databaseURL:       'https://crng-task-manager-default-rtdb.firebaseio.com',
  projectId:         'crng-task-manager',
  storageBucket:     'crng-task-manager.firebasestorage.app',
  messagingSenderId: '1050546278891',
  appId:             '1:1050546278891:web:a8c6771e03a1fc139989ae',
}

const app = initializeApp(firebaseConfig)

export const db   = getDatabase(app)
export const auth = getAuth(app)
