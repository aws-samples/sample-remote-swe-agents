import { afterAll, beforeAll, expect, test } from 'vitest';
import { fileEditTool } from './';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

const tempDirPath = join(tmpdir(), `worker-test-${randomBytes(6).toString('hex')}`);
beforeAll(async () => {
  mkdirSync(tempDirPath);
});

afterAll(async () => {
  rmSync(tempDirPath, { recursive: true, force: true });
});

test('success replace', () => {
  // GIVEN
  const tool = fileEditTool.handler;
  const file = `
interface Vehicle {
    brand: string;
    year: number;
    isElectric: boolean;
}

function displayVehicleInfo(vehicle: Vehicle): void {
    if (vehicle.isElectric) {
        console.log(vehicle.brand + ' (' + vehicle.year + ') - Electric Vehicle');
    } else {
        console.log(vehicle.brand + ' (' + vehicle.year + ') - Combustion Engine');
    }
}
`;
  const filePath = join(tempDirPath, `${randomBytes(6).toString('hex')}.ts`);
  writeFileSync(filePath, file, 'utf-8');

  // WHEN
  tool({
    filePath,
    oldString: `
function displayVehicleInfo(vehicle: Vehicle): void {
    if (vehicle.isElectric) {
        console.log(vehicle.brand + ' (' + vehicle.year + ') - Electric Vehicle');`,
    newString: `
function displayVehicleInfo(vehicle: Vehicle) {
    if (vehicle.isElectric) {
        console.log('Electric Vehicle');`,
  });
  const newFile = readFileSync(filePath, 'utf-8');

  // THEN
  expect(newFile).toEqual(`
interface Vehicle {
    brand: string;
    year: number;
    isElectric: boolean;
}

function displayVehicleInfo(vehicle: Vehicle) {
    if (vehicle.isElectric) {
        console.log('Electric Vehicle');
    } else {
        console.log(vehicle.brand + ' (' + vehicle.year + ') - Combustion Engine');
    }
}
`);
});
