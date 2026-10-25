import { type Profile } from 'game/profile/profile'
import { loadProfile, saveProfile } from 'game/profile/profileStore'
import { randomName } from 'game/profile/randomName'

/** This browser's profile; a new player gets a random one, saved for next time. */
export const loadPlayerProfile = (): Profile => loadProfile(window.localStorage, randomName, Math.random)

export const savePlayerProfile = (profile: Profile) => saveProfile(window.localStorage, profile)
