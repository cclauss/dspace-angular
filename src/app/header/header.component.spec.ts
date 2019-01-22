import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';

import { of as observableOf } from 'rxjs';
import { ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { MenuService } from '../shared/menu/menu.service';
import { MenuServiceStub } from '../shared/testing/menu-service-stub';
import { HeaderComponent } from './header.component';

let comp: HeaderComponent;
let fixture: ComponentFixture<HeaderComponent>;

describe('HeaderComponent', () => {
  const menuService = new MenuServiceStub();

  // async beforeEach
  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        NoopAnimationsModule,
        ReactiveFormsModule],
      declarations: [HeaderComponent],
      providers: [
        { provide: MenuService, useValue: menuService }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    })
      .compileComponents();  // compile template and css
  }));

  // synchronous beforeEach
  beforeEach(() => {
    spyOn(menuService, 'getMenuTopSections').and.returnValue(observableOf([]));

    fixture = TestBed.createComponent(HeaderComponent);

    comp = fixture.componentInstance;

  });

  describe('when the toggle button is clicked', () => {

    beforeEach(() => {
      spyOn(menuService, 'toggleMenu');
      const navbarToggler = fixture.debugElement.query(By.css('.navbar-toggler'));
      navbarToggler.triggerEventHandler('click', null);
    });

    it('should call toggleMenu on the menuService', () => {
      expect(menuService.toggleMenu).toHaveBeenCalled();
    });

  });
});
