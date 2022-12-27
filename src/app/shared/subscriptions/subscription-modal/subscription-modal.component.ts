import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { FormBuilder, FormGroup, Validators } from '@angular/forms';


import { BehaviorSubject, combineLatest, from, shareReplay } from 'rxjs';
import { map, mergeMap, take, tap } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { NgbActiveModal, NgbModal } from '@ng-bootstrap/ng-bootstrap';

import { Subscription } from '../models/subscription.model';
import { DSpaceObject } from '../../../core/shared/dspace-object.model';
import { SubscriptionService } from '../subscription.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PaginatedList } from '../../../core/data/paginated-list.model';
import { RemoteData } from '../../../core/data/remote-data';
import { getFirstCompletedRemoteData, getFirstSucceededRemoteDataPayload } from '../../../core/shared/operators';
import { AuthService } from '../../../core/auth/auth.service';
import { isNotEmpty } from '../../empty.util';
import { findIndex } from 'lodash';

@Component({
  selector: 'ds-subscription-modal',
  templateUrl: './subscription-modal.component.html',
  styleUrls: ['./subscription-modal.component.scss']
})
export class SubscriptionModalComponent implements OnInit {

  /**
   * DSpaceObject of which to get the subscriptions
   */
  @Input() dso: DSpaceObject;

  /**
   * If given the subscription to edit by the form
   */
  @Input() subscription: Subscription;

  /**
   * The eperson related to the subscription
   */
  ePersonId: string;

  /**
   * A boolean representing if a request operation is pending
   * @type {BehaviorSubject<boolean>}
   */
  public processing$ = new BehaviorSubject<boolean>(false);

  /**
   * Reactive form group that will be used to add/edit subscriptions
   */
  subscriptionForm: FormGroup;

  /**
   * Used to show validation errors when user submits
   */
  submitted = false;

  /**
   * Types of subscription to be shown on select
   */
  private subscriptionDefaultTypes = ['content', 'statistics'];

  /**
   * Frequencies to be shown as checkboxes
   */
  private frequencyDefaultValues = ['D', 'M', 'W'];

  /**
   * Event emitted when a given subscription has been updated
   */
  @Output() updateSubscription: EventEmitter<Subscription> = new EventEmitter<Subscription>();

  constructor(
    private formBuilder: FormBuilder,
    private modalService: NgbModal,
    private notificationsService: NotificationsService,
    private subscriptionService: SubscriptionService,
    public activeModal: NgbActiveModal,
    private authService: AuthService,
    private translate: TranslateService,
  ) {
  }

  /**
   * When component starts initialize starting functionality
   */
  ngOnInit(): void {
    this.authService.getAuthenticatedUserFromStore().pipe(
      take(1),
      map((ePerson) => ePerson.uuid),
      shareReplay(),
    ).subscribe((ePersonId: string) => {
      this.ePersonId = ePersonId;
      if (isNotEmpty(this.subscription)) {
        this.initFormByGivenSubscription();
      } else {
        this.initFormByAllSubscriptions();
      }
    });
  }

  private initFormByAllSubscriptions(): void {
    this.subscriptionForm = new FormGroup({});
    for (let t of this.subscriptionDefaultTypes) {
      const formGroup = new FormGroup({})
      formGroup.addControl('subscriptionId', this.formBuilder.control(''));
      formGroup.addControl('frequencies', this.formBuilder.group({}));
      for (let f of this.frequencyDefaultValues) {
        (formGroup.controls['frequencies'] as FormGroup).addControl(f, this.formBuilder.control(false));
      }
      this.subscriptionForm.addControl(t, formGroup)
    }

    this.initFormDataBySubscriptions();
  }

  /**
   * If the subscription is passed start the form with the information of subscription
   */
  initFormByGivenSubscription(): void {
    const formGroup = new FormGroup({})
    formGroup.addControl('subscriptionId', this.formBuilder.control(this.subscription.id));
    formGroup.addControl('frequencies', this.formBuilder.group({}));
    (formGroup.get('frequencies') as FormGroup).addValidators(Validators.required);
    for (let f of this.frequencyDefaultValues) {
      const value = findIndex(this.subscription.subscriptionParameterList, ['value', f]) !== -1;
      (formGroup.controls['frequencies'] as FormGroup).addControl(f, this.formBuilder.control(value));
    }

    this.subscriptionForm = this.formBuilder.group({
      [this.subscription.subscriptionType]: formGroup
    });
  }

  /**
   * Get subscription for the eperson & dso object relation
   * If no subscription start with an empty form
   */
  initFormDataBySubscriptions(): void {
    this.processing$.next(true);
    this.subscriptionService.getSubscriptionsByPersonDSO(this.ePersonId, this.dso?.uuid).pipe(
      getFirstSucceededRemoteDataPayload(),
    ).subscribe({
      next: (res: PaginatedList<Subscription>) => {
        if (res.pageInfo.totalElements > 0) {
          for (let subscription of res.page) {
            const type = subscription.subscriptionType;
            const subscriptionGroup: FormGroup = this.subscriptionForm.get(type) as FormGroup;
            if (isNotEmpty(subscriptionGroup)) {
              subscriptionGroup.controls['subscriptionId'].setValue(subscription.id);
              for (let parameter of subscription.subscriptionParameterList.filter((p) => p.name === 'frequency')) {
                (subscriptionGroup.controls['frequencies'] as FormGroup).controls[parameter.value]?.setValue(true);
              }
            }
          }
        }
        this.processing$.next(false);
      },
      error: err => {
        this.processing$.next(false);
      }
    });
  }

  /**
   * Create/update subscriptions if needed
   */
  submit() {
    this.submitted = true;
    const subscriptionTypes: string[] = Object.keys(this.subscriptionForm.controls);
    const subscriptionsToBeCreated = [];
    const subscriptionsToBeUpdated = [];

    subscriptionTypes.forEach((subscriptionType: string) => {
      const subscriptionGroup: FormGroup = this.subscriptionForm.controls[subscriptionType] as FormGroup;
      if (subscriptionGroup.touched && subscriptionGroup.dirty) {
        const body = this.createBody(
          subscriptionGroup.controls['subscriptionId'].value,
          subscriptionType,
          subscriptionGroup.controls['frequencies'] as FormGroup
        );

        if (isNotEmpty(body.id)) {
          subscriptionsToBeUpdated.push(body);
        } else if (isNotEmpty(body.subscriptionParameterList)) {
          subscriptionsToBeCreated.push(body);
        }
      }

    });

    const toBeProcessed = [];
    if (isNotEmpty(subscriptionsToBeCreated)) {
      toBeProcessed.push(from(subscriptionsToBeCreated).pipe(
        mergeMap((subscriptionBody) => {
          return this.subscriptionService.createSubscription(subscriptionBody, this.ePersonId, this.dso.uuid).pipe(
            getFirstCompletedRemoteData()
          )
        }),
        tap((res: RemoteData<Subscription>) => {
          if (res.hasSucceeded) {
            const msg = this.translate.instant('subscriptions.modal.create.success', { type: res.payload.subscriptionType });
            this.notificationsService.success(null, msg);
          } else {
            this.notificationsService.error(null, this.translate.instant('subscriptions.modal.create.error'));
          }
        })
      ));
    }

    if (isNotEmpty(subscriptionsToBeUpdated)) {
      toBeProcessed.push(from(subscriptionsToBeUpdated).pipe(
        mergeMap((subscriptionBody) => {
          return this.subscriptionService.updateSubscription(subscriptionBody, this.ePersonId, this.dso.uuid).pipe(
            getFirstCompletedRemoteData()
          )
        }),
        tap((res: RemoteData<Subscription>) => {
          if (res.hasSucceeded) {
            const msg = this.translate.instant('subscriptions.modal.update.success', { type: res.payload.subscriptionType });
            this.notificationsService.success(null, msg);
            if (isNotEmpty(this.subscription)) {
              this.updateSubscription.emit(res.payload);
            }
          } else {
            this.notificationsService.error(null, this.translate.instant('subscriptions.modal.update.error'));
          }
        })
      ));
    }

    combineLatest([...toBeProcessed]).subscribe((res) => {
      this.activeModal.close();
    });

  }

  private createBody(subscriptionId: string, subscriptionType: string, frequencies: FormGroup): Partial<any> {
    const body = {
      id: (isNotEmpty(subscriptionId) ? subscriptionId : null),
      type: subscriptionType,
      subscriptionParameterList: []
    };

    for (let frequency of this.frequencyDefaultValues) {
      if (frequencies.value[frequency]) {
        body.subscriptionParameterList.push(
          {
            name: 'frequency',
            value: frequency,
          }
        );
      }
    }

    return body;
  }

}
