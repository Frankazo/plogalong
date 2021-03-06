import { 
  Linking,
  YellowBox
 } from 'react-native';

import * as AppAuth from 'expo-app-auth';
import * as Facebook from 'expo-facebook';
import * as Google from 'expo-google-app-auth';
import * as GoogleSignIn from 'expo-google-sign-in';
import * as AppleAuthentication from 'expo-apple-authentication';

import config from '../config';
const { firebase: firebaseConfig } = config;

const InExpo = AppAuth.OAuthRedirect.indexOf('host.exp.exponent') !== -1;

import { auth, firebase, Users } from './init';
import { uploadImage } from './util';
import * as functions from './functions';


/**
 * @param {firebase.User} [user]
 */
const initialUserData = (user, locationInfo) => ({
  homeBase: locationInfo ? `${locationInfo.city}, ${locationInfo.region}` : '',
  displayName: user && user.displayName || 'Mysterious Plogger',
  shareActivity: false,
  emailUpdatesEnabled: false,
  privateProfile: false,
});


let onAuthStateChangedCallback = _ => {};
let unsubscribeAuthStateChange;
export function onAuthStateChanged(callback) {
  if (unsubscribeAuthStateChange)
    unsubscribeAuthStateChange();

  unsubscribeAuthStateChange = auth.onAuthStateChanged(callback);
  onAuthStateChangedCallback = callback;
  return unsubscribeAuthStateChange;
}

/**
 * @param {firebase.User|firebase.auth.UserCredential} user
 */
function _refreshUser(user) {
  if (user.user)
    user = user.user;

  onAuthStateChangedCallback(user);
  return user;
}

/**
 * @template P
 * @typedef { P extends PromiseLike<infer U> ? U : P } Unwrapped
 */

const withCredentialFn = (loginFn, credFn) => (
  (fn, canceledFn=null) => (
    async () => {
      try {
        const result = await loginFn();

        if (result.type === 'success')
          return await fn(credFn(result));

        return canceledFn ? canceledFn() : null;
      } catch (err) {
        if (err.code == -3) // cancelled
          return null;

        throw err;
      }
    }
  )
);

const withFBCredential = withCredentialFn(
  () => Facebook.logInWithReadPermissionsAsync(
    firebaseConfig.auth.facebook.appId,
    { permissions: ['public_profile'] }
  ),

  (c) => firebase.auth.FacebookAuthProvider.credential(c.token)
);


let GoogleInitialized = null;
const _googleInit = () =>  {
  if (!GoogleInitialized)
    GoogleInitialized = GoogleSignIn.initAsync().then(_ => true,
                                                      err => {
                                                        console.warn('GoogleSignIn.initAsync error', err);

                                                        GoogleInitialized = null;
                                                      });

  return GoogleInitialized;
};

/**
 * @template T
 * @param {(cred: firebase.auth.OAuthProvider) => Promise<T>} fn
 */
const withGoogleCredential =
      InExpo ?
      withCredentialFn(
        () => Google.logInAsync(firebaseConfig.auth.google),
        c => firebase.auth.GoogleAuthProvider.credential(c.idToken, c.accessToken)
      )
      :
      fn => (async () => {
        await _googleInit();
        await GoogleSignIn.askForPlayServicesAsync();
        const { type, user } = await GoogleSignIn.signInAsync();

        if (type === 'cancel')
          return null;

        const cred = firebase.auth.GoogleAuthProvider.credential(user.auth.idToken, user.auth.accessToken);
        return await fn(cred);
      });

if (InExpo)
  YellowBox.ignoreWarnings(['Deprecated: You will need to use expo-google-sign-in']);

/**
 * @template T
 * @param {(cred: firebase.auth.OAuthProvider) => Promise<T>} fn
 */
const withAppleCredential = fn => (
  async () => {
    try {
      const result = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL
        ]
      });

      const credential = new firebase.auth.OAuthProvider('apple.com')
            .credential({
              idToken: result.identityToken,
            });
      return await fn(credential);
    } catch (err) {
      if (err.code === 'ERR_CANCELED')
        return null;

      throw err;
    }
  }
);

/** @type {typeof auth.signInWithCredential} */
const signInWithCredential = auth.signInWithCredential.bind(auth);

/** @type {() => Promise<firebase.auth.UserCredential>} */
export const loginWithFacebook = withFBCredential(signInWithCredential);
/** @type {() => Promise<firebase.auth.UserCredential>} */
export const linkToFacebook = withFBCredential(
  cred => auth.currentUser.linkWithCredential(cred).then(_refreshUser));

export const unlinkFacebook = () =>
  auth.currentUser.unlink('facebook.com').then(_refreshUser);

/** @type {() => Promise<firebase.auth.UserCredential>} */
export const loginWithGoogle = withGoogleCredential(signInWithCredential);
/** @type {() => Promise<firebase.auth.UserCredential>} */
export const linkToGoogle = withGoogleCredential(cred => auth.currentUser.linkWithCredential(cred).then(_refreshUser));

export const unlinkGoogle = () => auth.currentUser.unlink('google.com').then(_refreshUser);

/** @type {() => Promise<firebase.auth.UserCredential>} */
export const loginWithApple = withAppleCredential(signInWithCredential);
/** @type {() => Promise<firebase.auth.UserCredential>} */
export const linkToApple = withAppleCredential(cred => auth.currentUser.linkWithCredential(cred).then(_refreshUser));
export const unlinkApple = () => auth.currentUser.unlink('apple.com').then(_refreshUser);


export const loginWithEmail = auth.signInWithEmailAndPassword.bind(auth);

export const linkToEmail = async (email, password) => {
  const credential = firebase.auth.EmailAuthProvider.credential(email, password);
  const userCred = await auth.currentUser.linkWithCredential(credential);
  
  _refreshUser(userCred);

  userCred.user.sendEmailVerification().catch(console.warn);

  return userCred.user;
};

export const logOut = () => auth.signOut();

/**
 * @param {firebase.firestore.DocumentReference} ref
 * @param {firebase.User} user
 */
async function initializeUserData(ref, user, store) {
  try {
    const r = await ref.get();
    if (r.exists) return;
  } catch (err) {
    console.warn('error getting user data', err);
  }

  // XXX Could easily get raced!
  const {locationInfo} = store.getState().users;
  await ref.set(initialUserData(user, locationInfo));
}

/**
 * @param {firebase.User} user
 */
export const getUserData = async (user, store) => {
  const ref = Users.doc(user.uid);

  await initializeUserData(ref, user, store);

  return ref;
};

export const setUserData = async (data) => {
  if (!auth.currentUser)
    return;

  const {profilePicture} = data;
  if (profilePicture && typeof profilePicture !== 'string') {
    delete data['profilePicture'];
  }

  const tasks = [
    Users.doc(auth.currentUser.uid).update(data).catch(x => {
      console.warn('error updating user', auth.currentUser, data, x);
    })
  ];
  
  if (profilePicture && profilePicture.uri)
    tasks.push(setUserPhoto(profilePicture));

  await Promise.all(tasks);
};

export const setUserPhoto = async ({uri}) => {
  await Users.doc(auth.currentUser.uid).update({
    profilePicture: await uploadImage(uri, `userpublic/${auth.currentUser.uid}/plog/profile.jpg`, { resize: { width: 300, height: 300 }})
  });
};

/**
 * Called as an anonymous user (A) with the uid of another user (B) to "merge" A
 * into B. The current session will be reauthenticated as B using `credentials`,
 * A's plogs will be moved over to B, and A will be deleted.
 *
 * @param {firebase.auth.AuthCredential} credential used to switch the current user
 * @param {any} match
 */
export const mergeAnonymousAccount = async (credential, match) => {
  if (!auth.currentUser || !auth.currentUser.isAnonymous)
    throw new Error('Must be logged in as an anonymous user');

  const anonUID = auth.currentUser.uid;
  await setUserData({ allowMergeWith: { providerId: credential.providerId, ...match  } });
  await auth.signInWithCredential(credential);
  await functions.mergeWithAccount(anonUID);
};
