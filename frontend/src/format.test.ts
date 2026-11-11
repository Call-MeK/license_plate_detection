import { expect, it } from 'vitest';
import { plateLines } from './format';

it('splits a plate into the two lines printed on the plate',()=>{
 expect(plateLines('88G133343')).toEqual(['88-G1','333.43']);
 expect(plateLines('29AA12345')).toEqual(['29-AA','123.45']);
 expect(plateLines('29A1234')).toEqual(['29-A','1234']);
 expect(plateLines('51LD1234')).toEqual(['51-LD','1234']);
 expect(plateLines('17A30892')).toEqual(['17-A','308.92']);
 // 8 ký tự kết thúc bằng 5 số: xe máy là seri chữ+số và 4 số.
 expect(plateLines('59V17937','MOTORBIKE')).toEqual(['59-V1','7937']);
 expect(plateLines('51f-123.45')).toEqual(['51-F','123.45']);
 expect(plateLines('ABC')).toEqual(['ABC']);
 expect(plateLines('')).toEqual(['']);
});
