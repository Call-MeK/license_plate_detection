import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Seg, useHotkeys } from './ui';

it('hides the segment highlight when nothing is selected',()=>{
 const options=[{value:'CAR',label:'Ô tô'},{value:'MOTORBIKE',label:'Xe máy'}];
 const {container,rerender}=render(<Seg label="Loại xe" value={'CAR' as string|null} onChange={()=>{}} options={options}/>);
 const thumb=container.querySelector<HTMLElement>('.thumb')!;
 expect(thumb.style.opacity).toBe('1');
 rerender(<Seg label="Loại xe" value={null} onChange={()=>{}} options={options}/>);
 expect(thumb.style.opacity).toBe('0');
});

function HotkeyPage({onEnter}:{onEnter:()=>void}){
 useHotkeys();
 return <><input type="file" aria-label="Video"/><input aria-label="Biển"/><label tabIndex={0}>Nhãn</label>
  <button type="button" data-kbd="Enter" onClick={onEnter}>Bắt đầu</button></>;
}
it('fires Enter shortcuts unless the user is typing in a text field',()=>{
 const onEnter=vi.fn();vi.spyOn(HTMLElement.prototype,'offsetParent','get').mockReturnValue(document.body);
 const {getByLabelText,getByText}=render(<HotkeyPage onEnter={onEnter}/>);
 getByLabelText('Video').focus();fireEvent.keyDown(document.activeElement!,{key:'Enter'});
 expect(onEnter).toHaveBeenCalledTimes(1);
 getByText('Nhãn').focus();fireEvent.keyDown(document.activeElement!,{key:'Enter'});
 expect(onEnter).toHaveBeenCalledTimes(2);
 getByLabelText('Biển').focus();fireEvent.keyDown(document.activeElement!,{key:'Enter'});
 expect(onEnter).toHaveBeenCalledTimes(2);
});
