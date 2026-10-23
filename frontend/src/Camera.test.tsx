import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CameraCard, PlateStep, useRecognition } from './Camera';

function Camera() {
 const rec=useRecognition('ENTRY',()=>{},()=>{});
 return <><CameraCard rec={rec}/><PlateStep rec={rec}/></>;
}

it('opens the rear camera and switches both ways, releasing the previous camera',async()=>{
 const stopRear=vi.fn(),stopFront=vi.fn();
 const rear={getTracks:()=>[{stop:stopRear}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'environment'})}]};
 const front={getTracks:()=>[{stop:stopFront}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'user'})}]};
 const getUserMedia=vi.fn().mockResolvedValueOnce(rear).mockImplementationOnce(async()=>{
  expect(stopRear).toHaveBeenCalledOnce();return front;
 }).mockImplementationOnce(async()=>{expect(stopFront).toHaveBeenCalledOnce();return rear;});
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 const {unmount}=render(<Camera/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
 await screen.findByText('Camera sau');
 expect(getUserMedia).toHaveBeenNthCalledWith(1,{video:{facingMode:{ideal:'environment'}},audio:false});
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await screen.findByText('Camera trước');
 expect(getUserMedia).toHaveBeenNthCalledWith(2,{video:{facingMode:{exact:'user'}},audio:false});
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await screen.findByText('Camera sau');
 expect(getUserMedia).toHaveBeenNthCalledWith(3,{video:{facingMode:{exact:'environment'}},audio:false});
 unmount();expect(stopRear).toHaveBeenCalledTimes(2);
});

it('clears a stopped source and explains when the other camera is unavailable',async()=>{
 const stop=vi.fn();
 const getUserMedia=vi.fn().mockResolvedValueOnce({getTracks:()=>[{stop}],getVideoTracks:()=>[{getSettings:()=>({facingMode:'environment'})}]}).mockRejectedValueOnce(new DOMException('missing','OverconstrainedError'));
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia}});
 vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 render(<Camera/>);
 fireEvent.click(screen.getAllByRole('button',{name:'Mở camera'})[0]);
 await screen.findByText('Camera sau');
 fireEvent.click(screen.getByRole('button',{name:'Đổi camera'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Không tìm thấy camera'));
 expect(stop).toHaveBeenCalledOnce();
 expect(screen.queryByRole('button',{name:'Bắt đầu nhận dạng Enter'})).toBeNull();
});
