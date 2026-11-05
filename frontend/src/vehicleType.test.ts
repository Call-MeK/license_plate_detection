import { expect, it } from 'vitest';
import { vehicleTypeFromPlate } from './format';

it('identifies the supported plate patterns and leaves ambiguous plates unresolved',()=>{
 expect(vehicleTypeFromPlate('51G99999')).toBe('CAR');
 expect(vehicleTypeFromPlate('59A112345')).toBe('MOTORBIKE');
 expect(vehicleTypeFromPlate('29AB90111')).toBeNull();
 expect(vehicleTypeFromPlate('AAS8797')).toBeNull();
});
