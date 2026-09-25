/** Normalised, device-agnostic input snapshot consumed by the player controller. */
export interface InputState {
  /** -1 (left) .. 1 (right), camera-relative. */
  moveX: number;
  /** -1 (back) .. 1 (forward), camera-relative. */
  moveZ: number;
  /** Pressed this frame (never a hold): M1, E, R, Q. */
  attack: boolean;
  skill: boolean;
  ultimate: boolean;
  dash: boolean;
  /** Held. */
  jump: boolean;
  /** F / the prompt button: unlock or equip the kit on the nearest pedestal. */
  interact: boolean;
}

export const createInputState = (): InputState => ({
  moveX: 0,
  moveZ: 0,
  attack: false,
  skill: false,
  ultimate: false,
  dash: false,
  jump: false,
  interact: false,
});
