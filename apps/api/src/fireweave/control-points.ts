// Every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
import { defineControlPoints } from '@fireweaveai/server-sdk/start';

export const controlPoints = defineControlPoints({
  chess: {
    local: true,
    description: 'Chess in the lobby and match API. Off hides the game.',
  },
});
