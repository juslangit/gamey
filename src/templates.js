// Starting ideas offered when a new game is made, and on an empty chat.
const IDEAS = {
  '2d': [
    { id: 'platformer', name: 'Platformer', blurb: 'Run, jump, collect coins, reach the flag', prompt: 'Make a side-scrolling platformer: a hero who runs and jumps across platforms, coins to collect with a score, a couple of patrolling enemies that end the game on touch, and a flag at the end of a level wider than the screen.' },
    { id: 'shooter', name: 'Space shooter', blurb: 'Dodge and blast waves of enemies', prompt: 'Make a top-down space shooter: a ship at the bottom that moves left and right and shoots, waves of enemies coming down, a score, three lives, and it gets faster over time.' },
    { id: 'catcher', name: 'Catch game', blurb: 'Catch the good things, dodge the bad', prompt: 'Make a simple catch game: a basket at the bottom that follows the arrow keys or the mouse, fruit falling from the top to catch for points, and bombs to avoid. 60 seconds per round.' },
    { id: 'blank', name: 'Blank', blurb: 'Start from nothing and describe it yourself', prompt: '' },
  ],
  '3d': [
    { id: 'runner', name: 'Endless runner', blurb: 'Dodge obstacles on a road that never ends', prompt: 'Make a 3D endless runner: a character on a three-lane road who switches lanes with left/right and jumps with space, obstacles and coins coming towards them, speed that slowly increases, and a score.' },
    { id: 'collector', name: 'Island collector', blurb: 'Explore a small island and find all the gems', prompt: 'Make a 3D game on a small island: a character that walks with WASD or the arrow keys and jumps, a follow camera, trees and rocks, and 8 glowing gems to find. Show how many are left and a win message at the end.' },
    { id: 'tower', name: 'Stack tower', blurb: 'Stack blocks as high as you can', prompt: 'Make a 3D stacking game: a block slides back and forth above the tower, press space to drop it, the overhang is cut off, and the tower gets taller while the camera rises. Count the height.' },
    { id: 'blank', name: 'Blank', blurb: 'Start from nothing and describe it yourself', prompt: '' },
  ],
};

module.exports = { IDEAS };
