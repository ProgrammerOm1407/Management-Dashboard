import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { resolveOrCreateUserProfile } from '../lib/firestoreService';
import { UserProfile } from '../types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  unprovisioned: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [unprovisioned, setUnprovisioned] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadProfile = async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setProfile(null);
      setUnprovisioned(false);
      setLoading(false);
      return;
    }

    if (!firebaseUser.email) {
      setAuthError('Your Google account does not provide a verified email address.');
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setAuthError(null);
    try {
      const result = await resolveOrCreateUserProfile(
        firebaseUser.uid,
        firebaseUser.email,
        firebaseUser.displayName || firebaseUser.email.split('@')[0]
      );
      setProfile(result.profile);
      setUnprovisioned(result.unprovisioned);
    } catch (err) {
      console.error('Profile resolution error:', err);
      setAuthError('Unable to verify your workspace profile. Please try signing in again.');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      void loadProfile(nextUser);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('popup-closed-by-user')
          ? 'Sign-in window was closed before completing authentication.'
          : 'Google sign-in failed. Please allow popups and try again.';
      setAuthError(message);
    }
  };

  const signOutUser = async () => {
    setAuthError(null);
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setUnprovisioned(false);
  };

  const refreshProfile = async () => {
    await loadProfile(auth.currentUser);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        unprovisioned,
        authError,
        signInWithGoogle,
        signOutUser,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
