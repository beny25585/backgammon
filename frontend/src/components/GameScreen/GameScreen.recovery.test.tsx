import { test, expect } from '@playwright/experimental-ct-react';
import GameScreen from './GameScreen';
import { MockGameWrapper } from '../../test-utils/wrappers';

test('closing an existing match requires explicit confirmation and server completion', async ({mount, page}) => {
  let leaves = 0;
  let exits = 0;
  await mount(<MockGameWrapper context={{leaveGame: () => {leaves++;}}}>
    <GameScreen closeExisting onLeave={() => {exits++;}} />
  </MockGameWrapper>);
  await expect(page.getByRole('heading', {name: 'לסיים את המשחק הקיים?'})).toBeVisible();
  expect(leaves).toBe(0);
  await page.getByRole('button', {name: 'אישור פרישה וסיום המשחק'}).click();
  await expect.poll(() => leaves).toBe(1);
  expect(exits).toBe(0);
});

test('a player can dismiss closure without forfeiting', async ({mount, page}) => {
  let leaves = 0;
  await mount(<MockGameWrapper context={{leaveGame: () => {leaves++;}}}>
    <GameScreen closeExisting />
  </MockGameWrapper>);
  await page.getByRole('button', {name: 'להמשיך במשחק'}).click();
  await expect(page.getByRole('heading', {name: 'לסיים את המשחק הקיים?'})).toHaveCount(0);
  expect(leaves).toBe(0);
});
