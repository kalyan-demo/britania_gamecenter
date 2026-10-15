// Every control point this app reads, with its LOCAL value.
// Production values come from FireWeave rollouts, never from this file.
import { defineControlPoints } from '@fireweaveai/web-sdk/start';

export const controlPoints = defineControlPoints({
  chess: {
    local: true,
    description: 'Chess in the lobby and on the board. Off hides the game.',
  },
});
