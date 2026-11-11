import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Seg } from './ui';

it('hides the segment highlight when nothing is selected',()=>{
 const options=[{value:'CAR',label:'Ô tô'},{value:'MOTORBIKE',label:'Xe máy'}];
 const {container,rerender}=render(<Seg label="Loại xe" value={'CAR' as string|null} onChange={()=>{}} options={options}/>);
 const thumb=container.querySelector<HTMLElement>('.thumb')!;
 expect(thumb.style.opacity).toBe('1');
 rerender(<Seg label="Loại xe" value={null} onChange={()=>{}} options={options}/>);
 expect(thumb.style.opacity).toBe('0');
});
